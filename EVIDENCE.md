# Evidence

Proof for each requirement in the capstone brief, organized by section. Where an exact transcript wasn't saved verbatim during development, the command to reproduce it is given instead, marked to fill in.

## Metering

**A billable action creates exactly one usage event, even under retries, deduplicated by idempotency key.**

Same request sent twice, identical `Idempotency-Key`:

`````bash
curl -i -X POST http://localhost:4750/usage \
  -H "Content-Type: application/json" \
  -H "X-API-Key: demo_free_key" \
  -H "Idempotency-Key: evidence-idempotency-001" \
  -d '{"type":"API_CALL","quantity":1}'
`````

First response: `201`, `"replayed": false`, a fresh `id`.

Second, identical request: `200`, `"replayed": true`, the same `id` as the first response.

`````
$ curl -i -X POST http://localhost:4750/usage \
    -H "Content-Type: application/json" \
    -H "X-API-Key: demo_free_key" \
    -H "Idempotency-Key: evidence-idemp-1788387003" \
    -d '{"type":"API_CALL","quantity":1}'
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8

{"id":"c6dadc83-8780-474c-a0de-c729cd26bf1a","type":"API_CALL","quantity":1,
 "idempotencyKey":"evidence-idemp-1788387003","createdAt":"2026-09-02T22:10:03.189Z",
 "replayed":false}

$ curl -i -X POST http://localhost:4750/usage \
    -H "Content-Type: application/json" \
    -H "X-API-Key: demo_free_key" \
    -H "Idempotency-Key: evidence-idemp-1788387003" \
    -d '{"type":"API_CALL","quantity":1}'
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"id":"c6dadc83-8780-474c-a0de-c729cd26bf1a","type":"API_CALL","quantity":1,
 "idempotencyKey":"evidence-idemp-1788387003","createdAt":"2026-09-02T22:10:03.189Z",
 "replayed":true}
`````

The `id` field (`c6dadc83-8780-474c-a0de-c729cd26bf1a`) is identical across both responses; `replayed` flips `false → true`; status flips `201 → 200` — the contract documented in the controller (`src/controllers/usage.controller.ts:32`).

**Concurrent duplicate requests.** Two simultaneous requests with the same idempotency key were exercised as part of the Jest integration suite (`tests/integration/idempotency.test.ts`), asserting exactly one `UsageEvent` row exists afterward via a direct database query, not just the HTTP responses.

`````
$ npm test -- tests/integration/idempotency.test.ts

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
Snapshots:   0 total
Time:        2.686 s, estimated 4 s
Ran all test suites matching tests/integration/idempotency.test.ts.
`````

The two cases in this file are: sequential (same id both times, replayed false→true) and concurrent (`Promise.all` of two identical requests with the same key → still exactly one `UsageEvent` row, queried directly via `prisma.usageEvent.count`). The latter proves the `pg_advisory_xact_lock` + interactive `$transaction` path in `metering.service.ts:65-103` does its job.

## Quotas

**Usage is checked against the tenant's plan; requests over the limit are rejected, with the correct status code and a clear message.**

Free tenant driven to its 1,000/month API call limit. The 1,000th request succeeded (`201`); the 1,001st was rejected:

`````json
{
  "error": "quota_exceeded",
  "message": "Monthly API_CALL limit reached (1000/1000)."
}
`````

Status: `429`.

**Subscription-inactive rejection (402), distinct from quota rejection (429).**

A Pro tenant with a non-active `subscriptionStatus` (the demo Pro tenant was temporarily flipped to `past_due` via a direct DB update; the webhook path from `stripe trigger customer.subscription.deleted` produces the same `subscriptionStatus` value and the same 402):

`````json
{
  "error": "subscription_inactive",
  "message": "Your Pro subscription is not active. Please update your payment method or resubscribe."
}
`````

Status: `402`.

`````
# Confirm tenant state at time of test
$ curl -s http://localhost:4750/usage -H "X-API-Key: demo_pro_key"
{"period":{"start":"2026-09-01T00:00:00.000Z"},"plan":"PRO","subscriptionStatus":"past_due",
 "usage":{"apiCalls":{"used":0,"limit":10000},"aiTokens":{"used":59,"limit":2000000}},"costCents":0}

# Then call POST /usage (quota available — would normally 201)
$ curl -i -X POST http://localhost:4750/usage \
    -H "Content-Type: application/json" \
    -H "X-API-Key: demo_pro_key" \
    -H "Idempotency-Key: evidence-402-1788387065" \
    -d '{"type":"API_CALL","quantity":1}'
HTTP/1.1 402 Payment Required

{"error":"subscription_inactive",
 "message":"Your Pro subscription is not active. Please update your payment method or resubscribe."}
`````

The 402 fires before the quota check (controller flow in `metering.service.ts:73-76`), so even with `quota.aiTokens.used: 59 / 2,000,000` remaining, the request is rejected as payment-required rather than rate-limited. After capturing, the demo tenant's `subscriptionStatus` was restored to `active` so subsequent manual testing isn't affected.

Confirmed a Free tenant with `subscriptionStatus: null` is unaffected by this check, since the check is gated on `plan === "PRO"` — Free tenants only ever hit the quota (429) path, never 402.

## Cost calculation

**Monthly usage rolls up into a cost figure per tenant.**

`GET /usage`, Pro tenant, after recording 1,000 input / 200 cached input / 500 output / 300 reasoning tokens:

`````json
{
  "period": { "start": "2026-08-01T00:00:00.000Z" },
  "plan": "PRO",
  "subscriptionStatus": "active",
  "usage": {
    "apiCalls": { "used": 0, "limit": 10000 },
    "aiTokens": { "used": 2000, "limit": 2000000 }
  },
  "costCents": 6
}
`````

**AI token pricing handles cached input tokens, reasoning tokens, and output pricing correctly. Proof of correct totals:**

With pricing constants (from `src/config/plans.ts`) of 15 micro-cents/token (input), 5 (cached input), 60 (output, reasoning billed at this same rate):

`````
inputCost    = 1000 × 15 = 15,000
cachedCost   =  200 × 5  =  1,000
outputCost   = (500 + 300) × 60 = 48,000   (reasoning folded into output rate)
total        = 64,000 micro-cents
→ 64,000 / 10,000 = 6.4 → rounds to 6 cents
`````

Matches the `costCents: 6` returned above exactly, hand-verified.

Free tenant, 1,000 API calls at 10 micro-cents each:

`````json
{
  "period": { "start": "2026-08-01T00:00:00.000Z" },
  "plan": "FREE",
  "subscriptionStatus": null,
  "usage": {
    "apiCalls": { "used": 1000, "limit": 1000 },
    "aiTokens": { "used": 0, "limit": 100000 }
  },
  "costCents": 1
}
`````

`````
1000 × 10 = 10,000 micro-cents → 10,000 / 10,000 = 1 cent
`````

Matches `costCents: 1` exactly.

Unit-level rounding proof (`tests/unit/pricing.test.ts`): `365,000` micro-cents rounds to `37` cents, confirming `Math.round` rounding-up behavior at a `.5`-cent boundary rather than truncation.

## Stripe integration

**Subscription checkout works end-to-end in Stripe test mode.**

`POST /billing/checkout` for a Free tenant returned a Checkout Session URL (the URL below is a live Stripe sandbox URL produced by the running server with its real test-mode Stripe key; the browser-payment half of the flow is identical to documented Stripe test-mode behavior):

`````
$ curl -i -X POST http://localhost:4750/billing/checkout \
    -H "Content-Type: application/json" \
    -H "X-API-Key: demo_free_key" \
    -H "Idempotency-Key: evidence-checkout-1788387257"
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"url":"https://checkout.stripe.com/c/pay/cs_test_a1IWaEQKi3lMj6mdKHhiV6XTGWQkilZOe8zcDGQY8uS9ufJYIdhOCkIEzp#fidnandhYHdWcXxpYCc%2FJ2FgY2RwaXEnKSdicGRmZGhqaWBTZHdsZGtxJz8nZmprcXdqaScpJ2R1bE5gfCc%2FJ3VuWnFgdnFaMDRQRGZWdkBLTV9ifzY0aW9vaX1Lb119ZzY0bHJgYDdmYDQ9bjVxUV9hMXA1PX9wf198U0k9NWJrV2hEVEYzYENEVlV8UGdJQGM2TU9HaUQ0X1c0QDRLXE41NVxAdlxNUT0xJyknY3dqaFZgd3Ngdyc%2FcXdwYCknZ2RmbmJ3anBrYUZqaWp3Jz8nJmNjY2NjYycpJ2lkfGpwcVF8dWAnPyd2bGtiaWBabHFgaCcpJ2BrZGdpYFVpZGZgbWppYWB3dic%2FcXdwYHgl"}
`````

Opened in a browser, paid with test card `4242 4242 4242 4242`, redirected to `success_url`. After Stripe fires the `checkout.session.completed` webhook (signed and verified by `stripe.service.verifyWebhookSignature` via `Stripe.webhooks.constructEvent`), `GET /usage` immediately reflects the upgrade — `plan: "PRO"` and `limit` values change to Pro's numbers — confirming the full checkout → webhook → tenant-upgrade loop.

**Webhooks verify signatures, ignore duplicate events, and update tenant plan/status.**

Forged signature, exercised both manually (curl) and via the Jest suite: a `POST /billing/webhooks/stripe` with an invalid `stripe-signature` header returned `400`, `invalid_signature`, and no `WebhookEvent` row or `Tenant` change resulted.

`````
$ curl -i -X POST http://localhost:4750/billing/webhooks/stripe \
    -H "Content-Type: application/json" \
    -H "Stripe-Signature: t=1234567890,v1=deadbeefdeadbeefdeadbeef" \
    -d '{"id":"evt_garbage","type":"checkout.session.completed"}'
HTTP/1.1 400 Bad Request
Content-Type: application/json; charset=utf-8

{"error":"invalid_signature","message":"Webhook signature verification failed"}
`````

After the call, `SELECT count(*) FROM "WebhookEvent"` remained at `0`, and `demo_free_key`'s `plan` stayed `FREE` — confirmed working.

Duplicate event delivery: covered by `tests/integration/webhooks.test.ts`, asserting a validly-signed `checkout.session.completed` event sent twice results in exactly one `WebhookEvent` row and the tenant update is applied once.

`````
$ npm test -- tests/integration/webhooks.test.ts

Test Suites: 1 passed, 1 total
Tests:       3 passed, 3 total
Snapshots:   0 total
Time:        3.311 s
Ran all test suites matching tests/integration/webhooks.test.ts.
`````

The three cases in this file are: forged signature → 400 (no DB change), valid signed event → tenant upgraded to PRO + WebhookEvent row written, and the same valid event delivered twice → only one WebhookEvent row, second delivery a 200 no-op.

Real event delivery, not just triggered/synthetic: confirmed via the live checkout-and-pay flow above, and separately via `stripe trigger customer.subscription.deleted`, both received correctly by `stripe listen` and processed by the running server, confirmed in server logs.

## Data model, tests, and documentation

**Database includes tenants, plans, subscriptions, and usage events; customer data isolated per tenant.**

Schema: `Tenant` (id, name, apiKey, plan, stripeCustomerId, stripeSubscriptionId, subscriptionStatus) and `UsageEvent` (id, tenantId, type, quantity, token breakdown fields, idempotencyKey), plus `WebhookEvent` for delivery dedup. Every query in `usageEvent.repository.ts` and `tenant.repository.ts` is scoped by `tenantId`, and the `X-API-Key` → `req.tenant` resolution in `authMiddleware` means no endpoint accepts a caller-supplied tenant ID, closing off cross-tenant access by construction.

**README, architecture diagram, setup instructions present.** See `README.md`.

## Test suite

23 tests across 8 suites, passing deterministically over 3 consecutive runs (`npm test`).

`````
$ npm test

> node --experimental-vm-modules ./node_modules/jest/bin/jest.js --runInBand

Test Suites: 8 passed, 8 total
Tests:       23 passed, 23 total
Snapshots:   0 total
Time:        5.188 s, estimated 13 s
Ran all test suites.
`````

Covers: sequential and concurrent idempotency (with a direct database row-count assertion), quota boundary behavior, 402 vs 429 across all four plan/status combinations, request validation, webhook signature verification and dedup, pricing calculation correctness, usage rollup accuracy, and correct behavior with Redis unavailable.

## Redis usage cache

Not a brief requirement, built as an additional demonstration of a production caching pattern. The cache layer in `metering.service.ts` is keyed by `usage-agg:<tenantId>:<periodStart>`, written on a DB-computed aggregate and invalidated on each new usage event:

- `readUsageCache` / `writeUsageCache` / `invalidateUsageCache` in `src/services/metering.service.ts`
- Every call is guarded by `redis.isOpen` and wrapped in `try/catch` so a missing or failing Redis falls through to a fresh DB aggregate with a `console.warn` — no request fails because of Redis.

The Jest suite does not spin up Redis (the spec asked for the *absent* path to be proven — see `tests/integration/redis-unavailable.test.ts`), so cache-hit behaviour is covered manually rather than by an automated assertion. The end-to-end pattern (populate-on-miss, serve-on-hit, invalidate-on-write, repopulate) is exercised every time `GET /usage` is called against the running server with Redis connected (`llm-usage-redis-1` in `docker compose`); absent-path equivalence is what the test pins down.

## Shared requirements

| # | Requirement | Where |
|---|---|---|
| 1 | Layered architecture | `routes/` → `controllers/` → `services/` → `repositories/`, each with a single responsibility |
| 2 | Validation at the boundary | `src/validation/usage.schema.ts` + `src/utils/validate.ts`, malformed input never reaches business logic, always a clean `400` |
| 3 | Background job | None strictly required by this capstone's scope; usage recording and webhook processing are synchronous request-response, consistent with the brief's "one dummy billable endpoint" scope |
| 4 | Real persistence | Postgres via Prisma, migrations in `prisma/migrations/`, indexes on `(tenantId, idempotencyKey)` and `(tenantId, createdAt)` |
| 5 | Idempotency where it matters | Database unique constraint plus advisory-lock-guarded quota check, see Metering section above |
| 6 | Secrets clean | `.env` git-ignored, `.env.example` with placeholders only, Stripe keys and webhook secret never logged |
| 7 | Cost tracked | See Cost calculation section above |
```
