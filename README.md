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
Only emails in `pb_admins` can use the admin page (manage them in Admin → Settings).

## Promo codes
Apply `supabase/migrations/20261025200000_promo_codes.sql` in the Supabase SQL Editor before deploying the promo-code UI. It creates the promo tables and booking RPCs and seeds `MASCOT15` for 15% off Mascot Surprise, limited to 10 successfully submitted bookings.

Admins can create, edit, pause, and cap promo codes in Admin → Promo codes. Discounts can be a percentage or a fixed AED amount, applied only to the matching required package or service. A use is counted atomically when a booking is submitted, including Pending requests. The selected required package or service and code are recorded with the booking. On its invoice, the discount is calculated against the matching item only; fixed discounts cannot exceed that item's price, and staff can adjust the invoice discount if needed.

## Deploy
Static site with no build step. Import the repo on Vercel (framework: Other) and deploy.
Add the deployed `/admin.html` URL to Supabase → Authentication → URL Configuration → Redirect URLs so password-reset links work.

Powered by Bready Web Studios.
