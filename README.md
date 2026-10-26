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
Venue photos go in the public storage bucket `polybelle`.
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
