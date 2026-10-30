# Polybelle Event Halls & Studio

Website and booking admin for Polybelle Event Halls & Studio (Abu Dhabi).

- `index.html`: public site with halls, packages, locations and the booking form
- `admin.html`: staff admin for bookings, halls/venues and settings
- `assets/config.js`: Supabase keys, branches, sessions, occasions and add-ons

## How booking works
1. Customer picks a hall, date and session (confirmed slots are blocked), then fills in details.
2. The request is saved to Supabase as **Pending** with a reference (e.g. `PB-261025-A1B2`).
3. WhatsApp opens with the full booking message, addressed to the booking number set in Admin → Settings (default 056 485 1757).
4. Staff confirm or cancel in the admin, then tap **WhatsApp customer** to send a prefilled reply.
   A hall can't have two confirmed bookings for the same date and session.
5. In Admin → booking → **Invoice**, set the line items and tap **Send invoice to customer**: it saves the invoice (assigning the next number if it's new), draws an A4 PDF with the same layout as **Save & open invoice** (real text in the site fonts from `assets/fonts/pdf/`), uploads it to the private `invoices` bucket and opens WhatsApp with the itemised message and a short link like `https://www.polybelle.me/i/K7Q2MX9AbC`. Each booking keeps one link that always opens its latest invoice/receipt (table `pb_invoice_files`, Edge Function `invoice`, `vercel.json` rewrite `/i/:code`).

## Backend (Supabase, breadywebstudios project)
Tables in `public`: `pb_venues`, `pb_bookings`, `pb_settings`, `pb_admins`.
Public RPCs: `pb_request_booking`, `pb_booked_slots`, `pb_public_settings`.
Venue photos go in the public storage bucket `polybelle`. Photos uploaded in the admin (halls, packages/services, gallery) are resized in the browser before upload (max 1600 px; 1000 px for service photos) and saved as WebP (JPEG on browsers without WebP support), so originals up to 25 MB are fine. The hero marquee shows every active gallery photo (in the order set in Admin → Gallery). `assets/parade-images/pic1.webp` … `pic16.webp` (about 1100 px, WebP) are only the stand-in photos, shown until the gallery loads or if it can't be reached.

Photo framing: in Admin → Halls & Services, open a hall or package/service and drag its photo (or use the arrow keys) to choose which part shows on the website card (halls are portrait 3:4, packages/services 4:3); **Center** resets it. Saved as `image_pos` (e.g. `30% 50%`) on `pb_venues` / `pb_services` (migration `20261026160000_image_position.sql`, already applied). Gallery photos show uncropped on the website, so they don't need framing.

Hall map locations: add an optional Google Maps URL or paste the full iframe embed code in Admin → Halls & Services → Edit hall. For a reliable embedded map, use Google Maps → Share → Embed a map; the admin extracts the iframe `src` when the full code is pasted. Regular place links are also supported when the location can be read from the URL. Configured locations appear as an embedded map and a Google Maps link on the public hall card. Apply `supabase/migrations/20261026203600_google_maps_venue_links.sql` before deploying this field.

Hall addresses: enter the written venue address in Admin → Halls & Services → Edit hall. It is shown in the public booking hall selector and booking summary, and included in the prefilled WhatsApp booking request. Apply `supabase/migrations/20261026212200_venue_address.sql` before deploying this field.
Only emails in `pb_admins` can use the admin page. Add a new admin in Admin → Settings with their email and initial password; the protected `admin-create-user` Supabase Edge Function creates the confirmed account and adds it to the allowlist. Deploy it with `supabase functions deploy admin-create-user` before using the form. It verifies the caller's signed-in admin status and uses the server-only Supabase service-role key; never put that key in website files. The form creates new Supabase accounts and will not change a password for an email that already has an account.

Passwords (Admin → Settings): **Change my password** updates the signed-in admin's own password after re-checking the current one. **Set password** next to another admin sets a new password through the same `admin-create-user` function (`action: "set_password"`); it only works for emails on the Polybelle admin list (checked by the server-only `pb_admin_auth_user_id` SQL function), because the login system is shared with other sites in this Supabase project.

## Email (Admin → Email)
Admins can send emails from any `@polybelle.me` address (e.g. `info@polybelle.me`), with CC, reply-to and attachments up to 10 MB in total. Every email (sent or failed) is listed under **Sent emails**, and **Send again / edit** copies one back into the form. In a booking, **Email customer** (shown when the booking has an email) opens the form already addressed to the customer and linked to the booking ref.

Sending goes through the protected `admin-send-email` Edge Function and [Resend](https://resend.com). It checks that the caller is a Polybelle admin and logs each email in `pb_emails`. One-time setup:
1. Create a Resend account, add the domain `polybelle.me` and add the DNS records it shows (SPF/DKIM, usually in Vercel → Domains → polybelle.me → DNS). Wait until Resend shows the domain as **Verified**.
2. Create a Resend API key with **Full access** (the Inbox uses the same key to read received emails; a "Sending access" key can't, and the Inbox would stay empty) and save it as a Supabase secret: `supabase secrets set RESEND_API_KEY=re_...` (or Dashboard → Edge Functions → Secrets).
3. Apply `supabase/migrations/20261029120000_admin_emails.sql` in the SQL Editor.
4. Deploy: `supabase functions deploy admin-send-email`.

## Inbox (Admin → Inbox)
Mail sent to **any** `@polybelle.me` address shows up in Admin → Inbox (unread count on the tab; the admin checks every minute). Open an email to read it. HTML emails are shown in a sandbox, so they can't run scripts. Attachments are listed with the email. Then use **Reply**, **Reply all** or **Forward**, which fill in the Email form. A reply is sent from the address the email was written to, keeps the customer's mail thread together (`In-Reply-To`/`References`), and marks the email **Replied**. Emails from an address that matches a booking are tagged **Customer · ref**. Emails that fail sender checks (SPF/DKIM/DMARC) are flagged **Check sender**. **Archive** hides an email from the Inbox view; **Delete** removes it and its attachments.

How it works: Resend receives the mail and calls the public `email-inbound` Edge Function with a signed webhook (`email.received`). The function checks the signature, fetches the full email from Resend, copies attachments (up to 25 MB each) into the private `inbox` bucket and saves the email in `pb_inbox`. Retried webhooks don't create duplicates. Received emails count toward Resend's 3,000 emails/month on the free plan.

One-time setup (after the Email setup above):
1. Apply `supabase/migrations/20261029130000_admin_inbox.sql` in the SQL Editor.
2. Deploy: `supabase functions deploy email-inbound --no-verify-jwt` (Resend can't send a Supabase login; the function checks Resend's signature instead).
3. Resend → Domains → polybelle.me → **Enable Receiving**. Add the MX record it shows on `polybelle.me` in Vercel DNS. It must have the lowest priority number on the domain, so delete any other mail service's MX records (e.g. Zoho's `mx.zoho.com`, `mx2`, `mx3`) first; that service then stops receiving. Click "I've added the record" and wait for **Verified**.
4. Resend → Webhooks → **Add webhook**: endpoint `https://ntohdxudxfggsmhxhvho.supabase.co/functions/v1/email-inbound`, event `email.received`. Copy its signing secret (`whsec_…`) and save it as the Supabase secret `RESEND_WEBHOOK_SECRET`.
5. Send a test email to `info@polybelle.me` and check that it appears in the Inbox. If it doesn't, check Resend → Webhooks for the delivery status. Failed deliveries are retried automatically and can be replayed from there.

## Calendars
- **Website → Halls → Check availability:** each hall card expands a monthly calendar under its row (below the swipe row on phones), built from `pb_booked_slots` (confirmed bookings only, no customer details). Days show available / some sessions booked / fully booked; tapping a day lists its sessions, and **Book this date** fills the booking form.
- **Admin → Calendar:** a monthly calendar of all bookings, filterable by hall (or services only), colour-coded by status with hall clashes outlined. Tap a booking to open it, tap the **+** on any day (today onwards) to add a booking for that date (and the selected hall), or tap a day to see its sessions and **+ Add booking**.

## Promo codes
Apply `supabase/migrations/20261025200000_promo_codes.sql` in the Supabase SQL Editor before deploying the promo-code UI. It creates the promo tables and booking RPCs and seeds `MASCOT15` for 15% off Mascot Surprise, limited to 10 successfully submitted bookings.

Admins can create, edit, pause, and cap promo codes in Admin → Promo codes. Discounts can be a percentage or a fixed AED amount, applied only to the matching required package or service. A use is counted atomically when a booking is submitted, including Pending requests. The selected required package or service and code are recorded with the booking. On its invoice, the discount is calculated against the matching item only; fixed discounts cannot exceed that item's price, and staff can adjust the invoice discount if needed.

## Under construction mode
Edit `assets/config.js` and set `underConstruction: true` to show visitors a "coming soon" page (with WhatsApp, phone and social links) instead of the website; set it back to `false` to go live. The text comes from `underConstructionMessage`. Only the public website is affected; the admin site keeps working. While it's on, open the site with `?preview` (e.g. `/?preview`) to see the real site on your device (a gold bar reminds you), and `?preview=off` to see the coming-soon page again.

## Deploy
Static site with no build step. Import the repo on Vercel (framework: Other) and deploy.
Powered by Bready Web Studios.

## Other venues (customer's own location)
- Apply `supabase/migrations/20261026180000_other_venue_settings.sql` in the Supabase SQL Editor before using the Other venues editor. In Admin → Halls & Services, edit halls to update details or hide them; deletion is blocked when a hall has booking history.
- **Website:** "Other venues" appears as the last card in the Halls section and as a choice in the booking form's hall picker. Edit its name, text, photo, and visibility under Admin → Halls & Services → Other venues. Choosing it makes a package / services booking: the customer types the **Event location (optional)** and must pick at least one package or service. The request is saved with no hall (`booking_type = Services`, `event_location` = what they typed).
- **Its calendar** (Check availability) shows sessions our team already has **confirmed** at other venues (bookings with no hall), and those sessions can't be picked in the form, the same way a hall's booked sessions work. This is checked in the browser only; the team can still add a booking for that session in the admin.
- **Admin:** the hall filters call these "Other venues". In the calendar, each Other venues booking shows its event location (📍) and the day panel shows which sessions are free or booked. On the invoice, Other venues bookings start with a priced **Event location** line, hall bookings with the priced **hall rental** line; if it was removed, **+ Event location price** / **+ Hall price** adds it back.

## Halls that share space
Some halls use the same room (e.g. **Hall A&B** includes **Hall B**). In Admin → Halls & Services → Edit hall, tick them under **Shares space with** (the link is saved on both halls). A confirmed booking in one then blocks that session in the other: on the website calendar and booking form, in the booking check on the server (`pb_request_booking` via `pb_linked_venues`), and in the admin's Hall clash warnings and calendar day panel. Hall A&B and Hall B are already linked.

## SEO
- Live address: **https://www.polybelle.me** (canonical; it's the primary domain in Vercel, and polybelle.me forwards to it). Don't add redirect rules between polybelle.me and www in code: Vercel's domain settings already handle that, and an opposite rule breaks the site.
- `index.html` head: description, canonical, Open Graph / WhatsApp preview (`assets/og-image.jpg`, 1200×630), icons in `assets/icons/`, `site.webmanifest`, and structured data (`LocalBusiness` + `EventVenue` with the three branches, phones, socials and services). Update the structured data if addresses, phones or opening hours change.
- `robots.txt` (blocks `admin.html`) and `sitemap.xml`. Submit `https://www.polybelle.me/sitemap.xml` in Google Search Console.
- The admin page has `noindex`. Photos get descriptive alt text from hall names, service names and gallery captions, so write clear gallery captions.


## GEO (AI search: ChatGPT, Google AI Overviews, Perplexity, Claude)
- `llms.txt`: a plain fact sheet (halls, addresses, capacities, sessions, services, contacts) that AI assistants can read and quote. Keep it in step with the FAQ and the structured data when anything changes.
- `robots.txt` explicitly allows the AI crawlers (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, etc.) and blocks only `admin.html`.
- Structured data: each hall is an `EventVenue` with its address, capacity and map; plus the `FAQPage` matching the FAQ section.
- The FAQ and About text are plain HTML (not loaded by JavaScript), so AI crawlers can read them. Halls, gallery and reviews load from the database, so key facts are repeated in the FAQ and `llms.txt`.
