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

## Backend (Supabase, breadywebstudios project)
Tables in `public`: `pb_venues`, `pb_bookings`, `pb_settings`, `pb_admins`.
Public RPCs: `pb_request_booking`, `pb_booked_slots`, `pb_public_settings`.
Venue photos go in the public storage bucket `polybelle`. Photos uploaded in the admin (halls, packages/services, gallery) are resized in the browser before upload (max 1600 px; 1000 px for service photos) and saved as WebP (JPEG on browsers without WebP support), so originals up to 25 MB are fine. The hero slideshow pictures live in `assets/parade-images/pic1.webp` … `pic16.webp` (about 1100 px, WebP); add new ones in the same size and format.

Photo framing: in Admin → Halls & Services, open a hall or package/service and drag its photo (or use the arrow keys) to choose which part shows on the website card (halls are portrait 3:4, packages/services 4:3); **Center** resets it. Saved as `image_pos` (e.g. `30% 50%`) on `pb_venues` / `pb_services` (migration `20261026160000_image_position.sql`, already applied). Gallery photos show uncropped on the website, so they don't need framing.
Only emails in `pb_admins` can use the admin page. Add a new admin in Admin → Settings with their email and initial password; the protected `admin-create-user` Supabase Edge Function creates the confirmed account and adds it to the allowlist. Deploy it with `supabase functions deploy admin-create-user` before using the form. It verifies the caller's signed-in admin status and uses the server-only Supabase service-role key; never put that key in website files. The form creates new Supabase accounts and will not change a password for an email that already has an account.

Passwords (Admin → Settings): **Change my password** updates the signed-in admin's own password after re-checking the current one. **Set password** next to another admin sets a new password through the same `admin-create-user` function (`action: "set_password"`); it only works for emails on the Polybelle admin list (checked by the server-only `pb_admin_auth_user_id` SQL function), because the login system is shared with other sites in this Supabase project.

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
