# Project X application

A separate full-stack application for Project X Contractors. The existing static HTML export remains unchanged outside this directory.

## Stack

- `frontend/`: React, TypeScript, Vite
- `backend/`: Express, TypeScript, SQLite
- Admin authentication: bcrypt password hashes and opaque, server-stored sessions in HttpOnly cookies
- Validation/security: Zod, Helmet, origin-restricted CORS, and rate limits

## Local setup

Requirements: Node.js 20.19+ or 22.12+, npm 10+.

1. From this directory, run `npm install`.
2. Copy `backend/.env.example` to `backend/.env` and set a unique `ADMIN_PASSWORD` (12+ characters) and the intended `ADMIN_EMAIL`.
3. Run `npm run dev`.
4. Open the Vite URL shown in the terminal (normally `http://localhost:5173`). The API runs on `http://localhost:4000`.

The owner account is created on first startup only when both admin environment variables are set and the users table is empty. Changing the environment variables later does not reset an existing password.

## Features

- Public request form creates a request record in SQLite.
- Admin sign-in, sign-out, session check, protected request inbox, and request status updates.
- Customer thank-you/receipt email through Resend and optional SMS through Twilio. Delivery is disabled unless provider credentials are configured.

## API

- `GET /api/health`: liveness check
- `POST /api/requests`: create a validated public project request
- `POST /api/auth/login`: staff sign-in
- `GET /api/auth/me`: check current session
- `POST /api/auth/logout`: revoke current session
- `GET /api/admin/requests`: list requests (authenticated)
- `PATCH /api/admin/requests/:id`: update request status (authenticated)
- `GET /api/admin/requests/:id/material-followups`: list material requests sent to a customer (authenticated)
- `POST /api/admin/requests/:id/material-followups`: save a material request and email the customer when Resend is configured (authenticated)
- `GET /api/admin/requests/:id/quotes`: list estimate/quote history for a request (authenticated)
- `POST /api/admin/requests/:id/quotes`: calculate material, labor, other, tax, and total; save the quote and email it when Resend is configured (authenticated)
- `GET /api/quotes/:publicToken`: read a quote from its unguessable customer link; returns sale prices only, never internal costs or margin
- `GET /api/admin/dashboard`: live request and catalog counters (authenticated)
- `GET /api/admin/materials`: list the saved material catalog (authenticated)
- `POST /api/admin/materials`: validate and save a material and its price source (authenticated)
- `GET /api/admin/inventory`: list stock, value totals, and recent movements (authenticated)
- `POST /api/admin/inventory/movements`: record a stock change with reason and staff audit identity (authenticated)

All API responses use JSON. The browser sends the HttpOnly session cookie with credentialed requests; mutating requests reject cross-origin browser origins.

## Material pricing

The material catalog is the approved source for prices used by this application. Record the supplier, unit, source (manual quote, invoice, CSV, or supplier API/feed), and update it from a current quote or invoice. For automatic pricing, request authorized customer-specific API/catalog or EDI access directly from Home Depot, Lowe's, TW Perry, or the actual distributor used by the business; availability and terms depend on the supplier account. Do not scrape retailer storefront pages: displayed prices can be location/account-specific and scraping can violate site terms. Gordian RSMeans is a licensed construction cost-estimating benchmark, not a live shelf-price feed. Confirm every price and date before sending a customer quote.

### Lowe's price snapshot

`backend/src/seed-lowes.ts` loads 10 starter catalog items with Lowe's prices. Run it with `npm run seed:lowes --workspace backend`.

- **Store and date:** prices are for Lowe's Washington, DC #3256 (ZIP 20006), checked on 2026-10-01. Each item stores this in `supplier_store` and `price_checked_at`, and the admin catalog shows it next to the price.
- **How they were collected:** read by hand from the individual product pages linked in `supplier_url`. They are not a live feed and are not refreshed automatically. Lowe's blocks automated requests (HTTP 403), and its prices depend on the selected store and account.
- **Thumbnails:** saved locally in `frontend/assets/products/` and referenced by `image_url`. They are Lowe's product photos, used only to identify the item in the admin catalog and on quotes.
- **Stock quantities:** the seed sets starting on-hand counts for the business's own inventory. They are not Lowe's store stock.
- **Re-running the seed:** items are matched by product URL (or by name). Their price, image, store and check date are refreshed, and duplicate rows with the same name are removed. If an item's on-hand count has dropped below its seed value, re-running raises it back to that value, so don't re-run it after you have started recording real stock movements.

Prices go out of date. Open the product link and confirm the price for your store before you use an item in a customer quote, then update the catalog entry.

Quote line unit cost is taken from the material catalog when selected. The admin's target gross margin is applied as `sale price = cost / (1 - margin)`, then the backend calculates the gross profit, effective margin, tax, and total in cents. Admin views show cost and margin; the emailed/private step-2 customer view shows material thumbnails and customer prices only. The email links to step 2 and carries the unguessable quote token into step 3's calculated 30% deposit summary. Payment collection itself is not integrated.

## External service choices

No external API is required to run the app. Configure these only when the business has created accounts and approved the required privacy/retention terms:

- Resend (transactional customer thank-you email): https://resend.com/ — set `RESEND_API_KEY`, a verified `RESEND_FROM_EMAIL`, and optionally `RESEND_REPLY_TO_EMAIL` in `backend/.env`.
- Twilio (SMS): https://www.twilio.com/ — set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`.
  - Staff alerts go to `STAFF_SMS_NUMBER` (the company phone, `+12024603027` by default in `.env.example`) for every new request and job application.
  - Customers are texted at the phone on their request only if they ticked the SMS consent box: on request received, when their site meeting is rescheduled, postponed or cancelled from the calendar, and when a quote is ready. Every customer text ends with "Reply STOP to opt out."
  - Without Twilio settings nothing is sent; the admin screens say "SMS is not set up yet" instead.

Never commit real keys. Use a verified sending domain for email. SMS requires customer consent and applicable opt-out/compliance handling; the initial scaffold sends no SMS unless fully configured. Payment collection is intentionally not integrated: choose a payment provider and obtain legal/accounting approval before implementing deposits. No address lookup API is needed for the initial request form.

## Deploying (one server for site + API)

The live site is **https://projectx.build**, hosted on AWS. Step-by-step instructions (Lightsail server, HTTPS with Caddy, systemd service, nightly S3 backups, DNS) are in [backend/deploy/aws/README.md](backend/deploy/aws/README.md); production settings start from `backend/.env.production.example`.

The backend can serve the built website, so the site and `/api` share one domain and no CORS or API URL setup is needed.

1. On the server: `npm ci`, then `npm run build` (builds `backend/dist` and `frontend/dist`, including all page photos).
2. Set these in `backend/.env` (or the host's environment settings):
   - `NODE_ENV=production`, `SERVE_FRONTEND=true`, `COOKIE_SECURE=true`
   - `FRONTEND_ORIGIN=https://<your domain>` (exactly the public URL; form posts from any other origin are rejected)
   - `DATABASE_PATH` on a persistent disk that is backed up
   - `ADMIN_EMAIL` and an `ADMIN_PASSWORD` of **12+ characters** for the first start on an empty database (startup fails otherwise)
   - `RESEND_*` (needed for customers to confirm their email) and, when ready, `TWILIO_*` and `STAFF_SMS_NUMBER`
3. Start with `npm start` behind HTTPS (the host's TLS or a reverse proxy) on `PORT`.

Pages use clean addresses: `/` (and `/work`) shows the Work page, then `/about`, `/careers`, `/contact`, `/privacy`, `/step-2-quote`, `/step-5-delivery`, and `/admin/<page>` for staff. Old `/pages/<page>.html` and `/admin/<page>.html` links, including emailed quote and confirmation links, redirect permanently to the clean address with their query kept. The dev server (`npm run dev`) uses the same addresses. Unknown pages return the site's 404 page, and the Content-Security-Policy allows only Google Fonts, the Google Maps embed and HTTPS images besides the site itself. To host the static site separately instead, build the frontend with `VITE_API_URL=https://<api domain>` and set `FRONTEND_ORIGIN` on the API to the site's URL.

## Search engines and link previews

With `SERVE_FRONTEND=true` the server builds these from `FRONTEND_ORIGIN`, so they follow the live domain automatically:

- `/robots.txt` allows the public site and blocks `/admin` and `/api`.
- `/sitemap.xml` lists the public pages with their last-changed date. Submit it in Google Search Console after launch.
- Every public page gets a canonical URL and Open Graph / Twitter tags (title, description, `assets/og-image.jpg` 1200×630), so shared links show a preview.

## Monitoring

- **Error log:** unexpected server errors and visitors' JavaScript errors are saved and shown on **Admin → Health** (newest 100, with details). Bad input from visitors is not counted as an error.
- **Instant alerts:** serious server errors and crashes text `STAFF_SMS_NUMBER` and email `ALERT_EMAIL` (needs Twilio / Resend), at most once per 15 minutes per problem. After a crash the process exits so the host restarts it.
- **"Site is down" alerts:** a stopped server cannot warn anyone, so add an external monitor (e.g. UptimeRobot or Better Stack, free tiers) that checks `https://<your domain>/api/health` every 5 minutes. It returns 200 only when the database answers too, and 503 otherwise.

## Before production

Use HTTPS and set `COOKIE_SECURE=true`; use a managed, encrypted database with backups and a migration/restore plan; set a strong admin password through your secret manager; configure exact public frontend/API origins; add email verification, password reset and staff invitation flows; add CSRF protection appropriate to the final deployment topology; establish privacy, retention, consent and audit-log policies; and test backups, rate limits, monitoring and incident response. SQLite is intended for local development and small single-instance deployments, not horizontally scaled production.
