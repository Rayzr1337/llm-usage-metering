# LLM Usage Metering and Billing Engine

A metering and billing service that tracks usage for LLM tokens and API calls, enforces plan quotas, calculates cost, and syncs subscription state through Stripe in test mode.

This project was developed as a capstone project for the FlyRank AI Backend AI Engineering Internship track.

## Status

Feature complete and manually verified end to end, including a Jest and Supertest test suite. Remaining: final evidence documentation and one last pass through the full acceptance-probe list.

## Stack

- Node.js, Express, TypeScript
- PostgreSQL via Docker Compose
- Prisma (pinned to stable 7.x)
- Redis for a usage cache
- Stripe (test mode) and Stripe CLI
- Zod

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL`, `APP_URL`, `PORT`, and your Stripe test keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`)
3. `docker compose up -d --build`, which builds the API, waits for Postgres and Redis to be ready, and applies migrations automatically
4. Seed two demo tenants: `npx prisma db seed`, creates `demo_free_key` (Free plan) and `demo_pro_key` (Pro plan)
5. In a separate terminal, forward Stripe webhooks: `stripe listen --forward-to localhost:<PORT>/billing/webhooks/stripe`, then copy the printed `whsec_...` into `.env` and restart the `api` service

## Running tests

```bash
npm test
```

Requires a real Postgres test database, separate from the dev database. See `tests/README.md` for setup.

## Architecture

```
Client -> POST /usage/generate
  -> resolve tenant from X-API-Key
  -> check for an existing idempotency key
     | found  -> return the original result
     | not found -> lock the tenant, check subscription status and quota, insert usage event

Client -> GET /usage
  -> resolve tenant from X-API-Key
  -> read the usage cache, or aggregate from usage events on a miss
  -> calculate cost from pricing constants

Client -> POST /billing/checkout
  -> resolve tenant from X-API-Key
  -> create or reuse the tenant's Stripe customer
  -> create a Checkout Session, return its URL

Stripe -> POST /billing/webhooks/stripe
  -> verify signature
  -> check whether this event id has already been processed
  -> apply the update (plan, subscription status)
```

## API

All auth-required routes need an `X-API-Key` header. `POST /usage/generate` and `POST /billing/checkout` also need a caller-generated `Idempotency-Key` header.

### `POST /usage/generate`

Records a billable usage event. Idempotent by key: replaying the same request with the same `Idempotency-Key` returns the original result instead of creating a second event.

**Headers**
```
X-API-Key: <tenant api key>
Idempotency-Key: <unique per logical request>
Content-Type: application/json
```

**Body, `API_CALL`**
```json
{ "type": "API_CALL", "quantity": 1 }
```

**Body, `AI_TOKENS`**
```json
{
  "type": "AI_TOKENS",
  "tokens": {
    "inputTokens": 1000,
    "cachedInputTokens": 200,
    "outputTokens": 500,
    "reasoningTokens": 300
  }
}
```
`quantity` for `AI_TOKENS` is derived as the sum of the four token fields, it should not be sent in the body.

**Success, `201` new event**
```json
{
  "id": "a1b2c3d4-...",
  "type": "API_CALL",
  "quantity": 1,
  "idempotencyKey": "checkout-test-002",
  "createdAt": "2026-08-15T10:00:00.000Z",
  "replayed": false
}
```

**Success, `200` replayed duplicate** — same shape, `"replayed": true`, same `id` as the original request.

**Errors**

| Status | `error` | When |
| --- | --- | --- |
| `400` | `validation_error` | Body fails schema validation. Response includes `details`, an array of `{ path, message }` |
| `400` | `missing_idempotency_key` | `Idempotency-Key` header not sent |
| `401` | `missing_api_key` | `X-API-Key` header not sent |
| `401` | `invalid_api_key` | No tenant matches the given key |
| `402` | `subscription_inactive` | Tenant is on the Pro plan but their subscription isn't active or trialing |
| `429` | `quota_exceeded` | This request would exceed the tenant's monthly quota for this usage type. Message includes the current used/limit numbers |

### `GET /usage`

Rolls up the current billing period's usage, quota, and cost for the authenticated tenant.

**Headers**
```
X-API-Key: <tenant api key>
```

**Success, `200`**
```json
{
  "period": { "start": "2026-08-01T00:00:00.000Z" },
  "plan": "PRO",
  "subscriptionStatus": "active",
  "usage": {
    "apiCalls": { "used": 847, "limit": 10000 },
    "aiTokens": { "used": 2000, "limit": 2000000 }
  },
  "costCents": 6
}
```

### `POST /billing/checkout`

Creates a Stripe Checkout Session for upgrading the tenant to Pro. No request body required.

**Headers**
```
X-API-Key: <tenant api key>
Idempotency-Key: <unique per logical request>
```

**Success, `201`**
```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_..." }
```

Open the returned `url` in a browser and pay with a Stripe test card to complete the upgrade.

### `POST /billing/webhooks/stripe`

Receives and processes Stripe events. Called by Stripe, not by API clients directly. Requires a valid `stripe-signature` header; the raw request body is used for signature verification, not parsed JSON.

**Success, `200`**
```json
{ "received": true }
```

**Errors**

| Status | `error` | When |
| --- | --- | --- |
| `400` | `missing_signature` | No `stripe-signature` header present |
| `400` | `invalid_signature` | Signature verification failed |

Events handled: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Each event's `id` is recorded once processed, so a redelivered event is acknowledged but not reapplied.

### `GET /health`

**Success, `200`**
```json
{ "status": "ok" }
```

No auth required.

## Payments

Test mode only, no real card or money ever involved. Test card `4242 4242 4242 4242`, any future expiry, any CVC.

The tenant's plan is only ever updated by the Stripe webhook, not by the browser redirect after checkout, since the redirect can be reached without paying.

Note: Stripe now uses per-sandbox test environments, each with its own keys and data. The Stripe CLI and the API key in `.env` must be pointed at the same sandbox, or webhook events will never arrive locally.

## Design decisions

- Tenants authenticate with a per-tenant API key sent as an `X-API-Key` header. There is no user or login model, since the brief only requires tenant isolation, not user identity.
- Money is computed internally in integer micro-cents (never floats) and only rounded to whole cents once, at the point of display or response, not at any intermediate step.
- Idempotency is enforced at the database layer with a unique constraint on `(tenantId, idempotencyKey)`, not just in application logic. A duplicate request returns the original recorded result rather than an error.
- The idempotency key is generated by the caller and sent as a request header, so a retried request reuses the same key.
- Usage is checked for an existing idempotency key before any quota check runs, so a retried request that already succeeded cannot be rejected by a quota that has since been reached.
- Quota checks and inserts for a given tenant are wrapped in a single transaction holding a Postgres advisory lock scoped to that tenant's ID, closing the race window where two concurrent requests could both pass a stale quota check.
- A Pro tenant without an active or trialing subscription is rejected with `402`, distinct from the `429` quota path. Free tenants, who have no subscription at all, are unaffected by this check.
- AI token usage stores a breakdown (input, cached input, output, reasoning) rather than a single quantity, so cost can be calculated correctly per category rather than at a single blended rate.
- Usage totals are not cached on the tenant record. `GET /usage` aggregates from usage event rows for the current billing period on a cache miss, so the event log remains the single source of truth.
- Webhook processing checks for an already processed event id and applies the resulting update inside a single transaction, so a redelivered event cannot be applied twice.

## Redis usage cache

`GET /usage`'s aggregation is cached per tenant per billing period, with a short TTL, and invalidated on every successful usage write. If Redis is unavailable, requests still succeed, aggregation just falls back to querying the database directly.

## Plans

| Plan | API calls | AI tokens |
| ---- | --------- | --------- |
| Free | 1,000 / month | 100,000 / month |
| Pro  | 10,000 / month | 2,000,000 / month |

Pricing constants (per-call and per-token-category, in micro-cents) are pinned in `src/config/plans.ts`.

## Evidence and build log

See `EVIDENCE.md` for proof of each requirement and `BUILDLOG.md` for a record of where AI tools were used during development.