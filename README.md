# Animal Lifeline — Backend

A Node.js / Express / MongoDB backend for Animal Lifeline, a platform
where people report injured animals, verified NGOs accept rescues,
volunteers help, and donors fund fundraising campaigns. There is no
frontend in this repository; the API is used from Bruno, Postman, or a
separate frontend.

## Tech stack

- Node.js, Express 5 (ES modules), Mongoose / MongoDB
- JWT access tokens (15 minutes) + rotating refresh tokens (30 days,
  httpOnly cookie `jwt_refresh`, single token per user)
- Razorpay for donations (orders, checkout verification, webhook)
- Cloudinary + Multer for document and photo uploads
- In-app notifications stored in MongoDB (no email, SMS or push service)

## Run it

```bash
cd backend
npm install
cp .env.example .env   # then fill in the real values (see below)
npm run dev            # nodemon, or: node server.js
```

The server listens on `PORT` (default 5000). Health check: `GET /`
returns "App is running". All API routes are under `/api/v1`.

## Configuration

All settings come from environment variables. Copy
`backend/.env.example` to `backend/.env` and fill it in. The example
file lists every variable with safe placeholders only — never commit a
real `.env` file.

| Variable | Used for |
| --- | --- |
| `PORT` | API port (default 5000) |
| `MONGO_URI` | MongoDB connection string |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | JWT signing |
| `CORS_ORIGIN` | Allowed frontend origin (default `http://localhost:3000`) |
| `NODE_ENV` | `production` makes cookies secure; anything else does not |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay order creation and checkout verification |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay webhook signature check (a different secret from the key secret) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Document and photo uploads |

Notes:

- Without Razorpay keys, the server still boots, but donation order
  creation returns 503 ("Online payments are not configured").
- Without Cloudinary keys, NGO and vet profile creation (which uploads
  documents) cannot complete; the rest of the API still works.
- There is no admin-creation endpoint. To make a user an admin, set
  their `role` to `admin` directly in the database.

## Authentication

- `POST /api/v1/users/register` — name, email, password, phone.
  Passwords must be strong and at least 8 characters. New users always
  start with role `user`.
- `POST /api/v1/users/login` — returns an access token and sets the
  `jwt_refresh` cookie.
- `POST /api/v1/users/refresh` — rotates the refresh token (reuse of an
  old token revokes the session).
- `POST /api/v1/users/logout` — revokes the refresh token and clears
  the cookie.
- Authenticated requests send `Authorization: Bearer <access token>`.
- Roles: `user`, `ngo`, `admin`, `vet`. NGO and vet roles are gained by
  creating a profile; verification is done by an admin.
- A suspended account cannot log in, refresh, or use authenticated
  routes. Temporary suspensions expire on their own (the first check
  after the expiry date lifts them); indefinite suspensions stay until
  an admin lifts them.

## Main routes (all under `/api/v1`)

| Area | Routes |
| --- | --- |
| Users | `/users` — register, login, logout, refresh, impact profile (`/users/impact-profile`) |
| NGOs | `/ngo` — profile create/update, own profile, verified list, nearby (`/ngo/nearby`, with `?includeVets=true`) |
| Vets | `/vets` — profile create/update, own profile, verified list, nearby |
| Nearby help (public, no login) | `GET /nearby/help?lng=&lat=&radiusKm=` (default 25 km, capped at 100 km) |
| Emergencies | `/emergency` — report, accept, status, progress updates (`/:id/updates`), request-info, unable-to-respond, my / assigned / open / detail (private: reporter, assigned NGO, admin only) |
| Donations | `/donations` — campaigns (create, list, mine, detail), donate, verify, impact, webhook (`POST /donations/webhook`, Razorpay-signed, no login) |
| Supplies | `/supplies` — requests, pledges, pledge status, impact, mine, detail |
| Volunteers | `/volunteer` — opportunities (general and emergency-linked), apply, applications, close, hero stories |
| Animals | `/animals` — list available, add, apply, NGO applications, approve/reject, detail |
| Notifications | `/notifications` — list mine, unread count, mark one read, mark all read |
| Reports | `/reports` — submit, my reports, detail (reporter or admin) |
| Admin | `/admin` — NGO/vet pending lists and verification, report queue and decisions, moderation (warn, suspend, lift, remove/restore campaign and content, escalate), action audit history, monitoring lists for users, campaigns and emergencies |

## Donations and Razorpay

Donations are money; supplies are in-kind pledges with no payment.

1. A verified NGO creates a campaign (`POST /donations/campaigns`).
2. A donor creates a Razorpay order (`POST /donations/campaigns/:id/donate`, amount at least ₹50).
3. After checkout, the frontend calls verify
   (`POST /donations/campaigns/:id/verify` with `razorpay_order_id`,
   `razorpay_payment_id`, `razorpay_signature`). The server checks the
   signature, re-reads the order from Razorpay, checks the order amount
   and that the campaign is still Active, then records the donor once
   (the payment id is guarded, so a retry or a webhook arriving first
   cannot count the same payment twice).
4. The Razorpay webhook (`POST /donations/webhook`, signed with
   `RAZORPAY_WEBHOOK_SECRET` over the raw body) is the safety net for
   payments that verify never sees. It only records `payment.captured`
   events, and only for Active campaigns.
5. When `raisedAmount` reaches `targetAmount`, the campaign becomes
   "Goal Reached" and stops taking donations.

## Testing with Bruno / Postman

There is no automated test suite in this repository. Test with
Bruno/Postman against a local server with a local MongoDB:

1. Register a donor user and an NGO user; set one user's role to
   `admin` directly in the database (see above).
2. Create the NGO profile (needs Cloudinary keys for document uploads,
   or seed a verified NGO directly in the database for flows that do
   not need uploads), then verify it as admin
   (`PATCH /admin/ngo/:id/verify` with `{"status": "verified"}`).
3. Exercise each flow and check the expected result in the response
   and, for notifications, in `GET /notifications` for the affected
   user. A real paid Razorpay order needs real Razorpay test-mode keys;
   with dummy keys, order creation fails at Razorpay (401), which
   proves the endpoint reaches Razorpay but cannot create a real order.

## Project layout

```
backend/
  server.js            Express app, mounts all routers under /api/v1
  Config/              Database connection
  Controllers/         One controller per feature area
  Models/              Mongoose models
  Routes/              One router per feature area
  Utils/               ApiError, ApiResponse, asyncHandler, Cloudinary,
                       token helpers, notification helper, suspension helper
  middlewares/         Auth (verifyJWT, isNgo, isVet, isAdmin), uploads, errors
  public/temp/         Temporary upload storage (Multer)
```

## Batch history

Work was implemented in batches against the SRS: Batch 1 (donations and
supply management), Batch 2 (emergency tracking, NGO geolocation and
authentication), Batch 3 (core backend fixes and browsing endpoints),
Batch 4 (verified vet network, public nearby help, volunteer system),
Batch 5 (in-app notifications, emergency progress updates, reporting,
admin investigation and moderation, impact counters, repository
hygiene). No email, SMS, push, chat, frontend, AI analysis, or separate
medical-record system is part of this backend.
