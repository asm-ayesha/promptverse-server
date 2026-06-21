# PromptVerse Server

Express + native MongoDB driver API for the **PromptVerse** AI prompt marketplace.
Authentication is handled by **better-auth on the Next.js client**; this server only
verifies the bearer (session) token against the shared MongoDB and runs the business APIs.

## Tech

- Express 5 (CommonJS)
- MongoDB native driver (no Mongoose)
- Stripe (one-time $5 premium unlock)
- ImgBB (thumbnail uploads)

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values
npm run dev            # node --watch index.js
```

### Environment variables

| Key | Description |
|-----|-------------|
| `PORT` | Server port (default 5000) |
| `MONGO_DB_URI` | Same Atlas connection string as the client |
| `BETTER_AUTH_SECRET` | Same secret as the client |
| `CLIENT_URL` | `http://localhost:3000` (CORS) |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `IMGBB_API_KEY` | ImgBB API key |

## Seed demo data

The Next.js client must be running first (so better-auth can hash passwords):

```bash
# terminal 1
cd ../promptverse-client && npm run dev
# terminal 2
cd promptverse-server && npm run seed
```

Creates demo accounts (`admin@aiverse.com`, `creator@aiverse.com`,
`user@aiverse.com`, password `123456`) and sample prompts.

## Auth model

The client sends `Authorization: Bearer <session-token>`. `verifyToken` looks the
token up in better-auth's `session` collection, loads the `user`, and attaches
`req.user` with `role` and `subscription`. Role guards use `requireRole(...)`.

## API overview

- `GET /api/prompts` — public list (search / filter / sort / pagination)
- `GET /api/prompts/featured` — featured/trending
- `GET /api/prompts/:id` — single prompt with premium visibility logic
- `POST/PATCH/DELETE /api/prompts` — prompt CRUD (auth)
- `POST /api/prompts/:id/copy` — copy + increment counter
- `POST /api/uploads/thumbnail` — ImgBB upload
- `POST /api/bookmarks/:promptId` — toggle bookmark
- `GET /api/bookmarks` — my bookmarks
- `POST /api/reviews`, `GET /api/reviews/prompt/:id` — reviews
- `POST /api/reports` — report a prompt
- `POST /api/payments/create-checkout-session`, `/webhook`, `/confirm` — Stripe
- `GET /api/creator/analytics` — creator dashboard data
- `GET /api/admin/*` — users, prompts, payments, reports, analytics
- `GET /api/home/top-creators`, `/api/home/reviews` — home aggregation
