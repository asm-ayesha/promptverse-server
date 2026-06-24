# PromptVerse Server

The backend API for **PromptVerse** - an AI prompt marketplace where people discover, share, buy, and review high-quality prompts for tools like ChatGPT, Midjourney, and more.

This repository is the **server / REST API** only. It pairs with the **PromptVerse Next.js client** (`promptverse-client`), which handles the user interface and authentication. Both apps share the same MongoDB database.

> **Live API:** [https://promptverse-server.onrender.com](https://promptverse-server.onrender.com)

---

## What this project does

PromptVerse is a community marketplace for AI prompts. With this API, the client app can:

- Browse a public catalog of prompts with **search, filtering, sorting, and pagination**.
- Let creators **publish prompts** (which go through an admin review queue).
- Let users **bookmark**, **copy**, and **review** prompts.
- Sell a one-time **$5 Premium** upgrade that unlocks private/premium prompts.
- Give admins tools to **moderate** content, handle **reports**, and view **analytics**.

### User roles

| Role | What they can do |
|------|------------------|
| **User** (free) | Browse, copy public prompts, bookmark, review, add up to **3** prompts |
| **User** (premium) | Everything above + unlock premium prompts and add **unlimited** prompts |
| **Creator** | Publish prompts and view a personal analytics dashboard |
| **Admin** | Approve/reject/feature/delete prompts, manage users, resolve reports, see platform analytics |

---

## Tech stack

- **Express 5** (CommonJS) - HTTP server and routing
- **MongoDB** native driver (no Mongoose) - database access
- **Stripe** - one-time $5 premium unlock
- **ImgBB** - prompt thumbnail image hosting
- **jose** - token verification helper

> Authentication itself is handled by **better-auth on the Next.js client**. This server does not create sessions - it only verifies the bearer (session) token against the shared database and runs the business logic.

---

## Project structure

```
promptverse-server/
├── index.js          # All routes, middleware, and server bootstrap
├── seed.js           # Seeds demo accounts and sample prompts
├── utils/
│   └── imgbb.js      # Helper for uploading thumbnails to ImgBB
├── .env.example      # Template for required environment variables
└── package.json
```

---

## Getting started

### Prerequisites

- **Node.js 18+**
- A **MongoDB** database (e.g. MongoDB Atlas) - the same one used by the client
- A **Stripe** account (test mode is fine) - optional, only needed for payments
- An **ImgBB** API key - optional, only needed for image uploads

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Then fill in the values:

| Key | Required | Description |
|-----|----------|-------------|
| `PORT` | No | Server port (defaults to `5000`) |
| `MONGO_DB_URI` | **Yes** | MongoDB connection string (same database as the client) |
| `BETTER_AUTH_SECRET` | **Yes** | Must match the secret used by the client |
| `CLIENT_URL` | **Yes** | Client origin for CORS and Stripe redirects (e.g. `http://localhost:3000`) |
| `STRIPE_SECRET_KEY` | No* | Stripe secret key (`sk_test_...` or `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | No* | Stripe webhook signing secret (only needed if you register a webhook) |
| `IMGBB_API_KEY` | No* | ImgBB API key for thumbnail uploads |

> \* Payments and uploads are optional features. If `STRIPE_SECRET_KEY` is missing, payment endpoints respond with `503` and the rest of the app keeps working.

### 3. Run the server

```bash
npm run dev     # development with auto-reload (node --watch)
npm start       # production
```

The API will be available at `http://localhost:5000` locally, or live at [https://promptverse-server.onrender.com](https://promptverse-server.onrender.com). Visit [`/health`](https://promptverse-server.onrender.com/health) to check status and database connectivity.

---

## Seed demo data (optional)

The Next.js client must be running first, so better-auth can hash the demo passwords:

```bash
# terminal 1 - start the client
cd ../promptverse-client && npm run dev

# terminal 2 - seed the database
cd promptverse-server && npm run seed
```

This creates demo accounts and sample prompts:

| Account | Password | Role |
|---------|----------|------|
| `admin@aiverse.com` | `123456` | Admin |
| `creator@aiverse.com` | `123456` | Creator |
| `user@aiverse.com` | `123456` | User |

---

## How authentication works

1. The user logs in on the **client** (better-auth).
2. The client sends every API request with an `Authorization: Bearer <session-token>` header.
3. The server's `verifyToken` middleware looks the token up in better-auth's `session` collection, loads the matching `user`, and attaches `req.user` (including `role` and `subscription`).
4. Role-restricted routes are protected by a `requireRole(...)` guard.

Public endpoints (like browsing prompts) work without a token; some use `optionalAuth` to personalize results when a token is present.

---

## How payments work

PromptVerse sells a single **$5 one-time "Lifetime Premium"** unlock via Stripe, using the embedded **Payment Element** flow:

1. The client requests a PaymentIntent from `POST /api/payments/create-payment-intent`.
2. The user pays directly through Stripe on the client.
3. The client calls `POST /api/payments/confirm`, and the **server verifies the payment with Stripe** before upgrading the account to premium.

Premium is **only** granted when Stripe itself confirms the payment as succeeded - there is no fallback.

The `POST /api/payments/webhook` endpoint is an **optional but recommended** safety net for production. It activates premium even if the user's browser closes right after paying. To enable it, register your public URL (`https://promptverse-server.onrender.com/api/payments/webhook`) in the Stripe Dashboard and set `STRIPE_WEBHOOK_SECRET`. For local testing, use the Stripe CLI:

```bash
stripe listen --forward-to localhost:5000/api/payments/webhook
```

---

## API reference

All routes are prefixed by the server origin:

- **Local:** `http://localhost:5000`
- **Production:** `https://promptverse-server.onrender.com`

🔒 = requires authentication, 👑 = admin only.

### Health & meta

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Simple "API is running" check |
| `GET` | `/health` | JSON status + database connectivity |
| `GET` | `/api/meta` | Filter options (AI tools, categories, etc.) |

### Prompts

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/prompts` | Public catalog with search / filter / sort / pagination |
| `GET` | `/api/prompts/featured` | Featured / trending prompts |
| `GET` | `/api/prompts/:id` | Single prompt (premium content is gated) |
| `GET` | `/api/my/prompts` 🔒 | Prompts created by the current user |
| `POST` | `/api/prompts` 🔒 | Create a prompt (enters review queue) |
| `PATCH` | `/api/prompts/:id` 🔒 | Update own prompt (resets to pending) |
| `DELETE` | `/api/prompts/:id` 🔒 | Delete own prompt |
| `POST` | `/api/prompts/:id/copy` 🔒 | Copy a prompt and increment its counter |

### Bookmarks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/bookmarks/:promptId` 🔒 | Toggle bookmark on/off |
| `GET` | `/api/bookmarks` 🔒 | List the current user's bookmarks |

### Reviews & reports

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/reviews` 🔒 | Add a review (recomputes the prompt's rating) |
| `GET` | `/api/reviews/prompt/:promptId` | Reviews for a prompt |
| `GET` | `/api/my/reviews` 🔒 | The current user's reviews |
| `POST` | `/api/reports` 🔒 | Report a prompt |

### Uploads

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/uploads/thumbnail` 🔒 | Upload a thumbnail image to ImgBB |

### Payments

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/payments/create-payment-intent` 🔒 | Start the embedded payment flow |
| `POST` | `/api/payments/create-checkout-session` 🔒 | Start a Stripe Checkout (redirect) flow |
| `POST` | `/api/payments/confirm` 🔒 | Verify the payment and grant premium |
| `POST` | `/api/payments/webhook` | Stripe webhook (signature-verified) |

### Home & creator

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/home/top-creators` | Top creators for the homepage |
| `GET` | `/api/home/reviews` | Recent reviews for the homepage |
| `GET` | `/api/creator/analytics` 🔒 | Creator dashboard data |
| `GET` | `/api/users/me` 🔒 | The current user's profile + prompt count |

### Admin 👑

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/users` | List users |
| `PATCH` | `/api/admin/users/:id/role` | Change a user's role |
| `DELETE` | `/api/admin/users/:id` | Delete a user |
| `GET` | `/api/admin/prompts` | List all prompts |
| `PATCH` | `/api/admin/prompts/:id/approve` | Approve a prompt |
| `PATCH` | `/api/admin/prompts/:id/reject` | Reject a prompt |
| `PATCH` | `/api/admin/prompts/:id/feature` | Feature / unfeature a prompt |
| `DELETE` | `/api/admin/prompts/:id` | Delete a prompt |
| `GET` | `/api/admin/payments` | List payment records |
| `GET` | `/api/admin/reports` | List reports |
| `PATCH` | `/api/admin/reports/:id` | Act on a report (remove / warn / dismiss) |
| `GET` | `/api/admin/analytics` | Platform-wide analytics |

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with auto-reload (`node --watch`) |
| `npm start` | Start the server |
| `npm run seed` | Seed demo accounts and sample prompts |

---
