# CLAUDE.md — Roundtable Finance

This file provides guidance to Claude Code when working in this repository.
Always read this file fully at the start of every session before making any changes.

> **Working title.** "Roundtable Finance" is a placeholder — rename via find-and-replace once a final brand is chosen.

---

## Project Overview

**Roundtable Finance** is a private personal-finance app for a single household.
It tracks income, expenses, budgets, recurring bills, savings goals, debts, and net
worth, with AI assistance for receipt scanning, auto-categorization, monthly insights,
and a conversational finance assistant. Bank accounts can be connected for automatic
transaction import (Plaid), with manual entry and receipt scanning for everything else.

The core model is a single shared **Household**: the two account holders both have full
read/write access to all household financial data. There is no per-account privacy
control and no public/social surface — every byte is private to the household.

**This is a personal app, not a SaaS.** There is no monetization, no subscription tiers,
no admin panel, no public browsing, and no marketing funnel. If those are ever needed,
they get added deliberately later — do not scaffold them speculatively.

**Domain**: TBD
**Tagline**: TBD

---

## Build & Development Commands

- `npm run dev` — Start development server (http://localhost:3000)
- `npm run build` — Production build
- `npm run start` — Start production server
- `npm run lint` — Run ESLint
- `vercel --prod` — Deploy to production (requires Vercel CLI)

No test framework is configured yet.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | Next.js 16 (App Router) | Full-stack web framework |
| Language | TypeScript | Type safety throughout |
| Frontend | React 19 + React Compiler | UI rendering |
| Styling | Tailwind CSS 4 | Utility-first styling |
| Components | shadcn/ui (Radix Nova) | Pre-built accessible UI components |
| Backend | Supabase | Database, auth, RLS |
| ORM | Supabase JS Client | Database queries |
| Auth | Supabase Auth | Email/password authentication |
| Bank sync | Plaid | Account linking, transactions, balances, liabilities |
| Storage | Cloudflare R2 (private) | Receipt & statement uploads — signed URLs only |
| AI | Anthropic Claude API | Receipt scan, categorization, insights, assistant |
| Email | Resend | Transactional emails (confirm, reset, household invite) |
| Hosting | Vercel | Deployment + preview URLs |
| DNS/CDN | Cloudflare | DNS, SSL, DDoS, WAF, Turnstile |
| Charts | Recharts | Spending/trend/net-worth charts |
| Icons | lucide-react | Icon library |
| Notifications | sonner | Toast notifications |
| Theming | next-themes | Dark/light mode |
| Dates | date-fns | Date formatting & manipulation |
| Money | Intl.NumberFormat | Currency formatting (amounts stored as integer cents) |

> **Deliberately NOT included** (vs. Round Table Recipes): Stripe, an admin panel,
> public profiles/browsing, seat-tier/family-plan logic, and marketing pages.

---

## Architecture

### Path Aliases
`@/*` maps to `./src/*` (configured in tsconfig.json)

### Key Patterns
- shadcn components live in `src/components/ui/`; add via `npx shadcn@latest add <component>`
- `cn()` utility in `src/lib/utils.ts` merges Tailwind classes (clsx + tailwind-merge)
- Theme variables defined in `src/app/globals.css` with light/dark variants
- shadcn config in `components.json` (style: radix-nova, base color: neutral, RSC enabled)
- Supabase server client via `@supabase/ssr` for server components and API routes
- Supabase browser client for client components
- Auth middleware via custom `src/proxy.ts` (NOT `middleware.ts`) — refreshes sessions and redirects unauthenticated users
- **Server Actions used for all database mutations — never direct browser client inserts**
- **Every finance query is scoped to the caller's household** (see Security Rules) — there is no global/public read path
- Homepage (`/`) redirects authenticated users to `/dashboard` via server-side session check
- **All monetary amounts are stored as integer cents (`bigint`)** — never floats. Format at the edge with `Intl.NumberFormat`.

### Folder Structure
```
src/
├── app/
│   ├── (auth)/                # login, register, forgot-password, reset-password
│   ├── (app)/                 # Protected pages:
│   │   ├── dashboard/         # Net worth, balances, this-month in/out, recent activity, insight card
│   │   ├── accounts/          # Account list + detail (manual + linked), balances
│   │   ├── transactions/      # Ledger: list, filters, manual add, receipt scan, edit/split
│   │   ├── budgets/           # Per-category budgets + progress
│   │   ├── bills/             # Recurring bills & income (recurring_rules)
│   │   ├── goals/             # Savings goals
│   │   ├── debts/             # Debt tracking (manual + Plaid Liabilities)
│   │   ├── insights/          # Monthly AI summaries, charts, reports
│   │   ├── assistant/         # Conversational finance assistant
│   │   ├── household/         # Household settings + invite
│   │   └── settings/          # Profile, currency/locale, fiscal month start
│   ├── api/                   # Route handlers:
│   │   ├── plaid/             # create-link-token, exchange-token, webhook, sync
│   │   └── upload/            # Receipt/statement upload (R2, private)
│   ├── auth/                  # Auth callback (confirm/ — PKCE + token_hash)
│   ├── layout.tsx             # Root layout (fonts, theme, metadata, PWA)
│   ├── page.tsx               # Landing/redirect
│   └── globals.css            # Global styles + theme variables
├── components/
│   ├── ui/                    # shadcn/ui (do not edit manually)
│   ├── layout/                # Header, sidebar/nav, footer
│   ├── accounts/ transactions/ budgets/ bills/ goals/ debts/ insights/ assistant/ household/
│   └── shared/                # Service worker register, Turnstile widget, currency display
├── lib/
│   ├── supabase/             # client.ts, server.ts, service.ts (service-role)
│   ├── validations/          # Zod schemas (account, transaction, budget, recurring, goal, debt, household, profile)
│   ├── types/                # TS types (database.ts, plaid.ts, ai.ts)
│   ├── plaid/                # client.ts, sync.ts, webhook-verify.ts, token-vault.ts
│   ├── ai/                   # receipt-scan.ts, categorize.ts, insights.ts, assistant.ts
│   ├── ai-models.ts          # SINGLE source of truth for Anthropic model strings
│   ├── money.ts              # cents<->display helpers, formatCurrency()
│   ├── categories.ts         # Default category seed + Category type (shared client/server)
│   ├── rate-limit.ts         # Per-user AI usage rate limiting (Postgres RPC)
│   ├── rate-limit-ip.ts      # In-memory IP rate limiter (login, register, search)
│   ├── auth-helper.ts        # getAuthUser() for server actions
│   ├── household.ts          # getCurrentHousehold() + membership helpers
│   ├── file-validation.ts    # Magic-byte detection for uploads
│   ├── r2.ts                 # Cloudflare R2 client + signed-URL helpers (PRIVATE bucket)
│   ├── safe-redirect.ts      # Same-origin redirect sanitizer
│   ├── turnstile.ts          # Cloudflare Turnstile verification
│   ├── resend.ts / emails.ts # Email client + templates
│   └── disposable-domains.ts # Disposable email blocklist
├── hooks/
├── constants/
└── proxy.ts                  # Auth middleware (session refresh, route protection)

public/
├── manifest.json   sw.js   offline.html   logo.svg   icons/
```

### PWA
Web app manifest at `public/manifest.json`; manual service worker at `public/sw.js`
(cache-first static, network-first nav, offline fallback). Registered via
`src/components/shared/service-worker-register.tsx` (production only). `next-pwa` is
incompatible with Next.js 16 Turbopack — use the manual service worker.

---

## Database Schema (Supabase / PostgreSQL)

> **Money rule:** every amount column is `bigint` storing **integer cents**, paired with a
> `currency` (text, ISO 4217). Never store money as float/decimal-with-rounding.

### Identity & household

**profiles** (extends Supabase auth.users)
- id (uuid, FK auth.users), full_name, avatar_url
- default_currency (text, default `USD`), locale (text, default `en-US`)
- fiscal_month_start_day (int, default 1)
- created_at, updated_at

**households**
- id (uuid), name (text), owner_id (uuid, FK profiles)
- invite_code (text, unique)
- created_at, updated_at

**household_members**
- id (uuid), household_id (FK households), user_id (FK profiles)
- role (enum: owner, member) — reserved for future kid/teen roles; both adults are full members today
- joined_at
- UNIQUE(household_id, user_id)

### Accounts & bank links

**accounts**
- id (uuid), household_id (FK households)
- name, type (enum: checking, savings, credit_card, cash, investment, loan)
- institution (text, nullable)
- current_balance_cents (bigint), currency (text)
- is_manual (bool, default true), is_archived (bool, default false)
- plaid_item_id (uuid, FK plaid_items, nullable), plaid_account_id (text, nullable)
- created_at, updated_at

**plaid_items** (one row per connected bank login)
- id (uuid), household_id (FK households), created_by (FK profiles)
- item_id (text, unique), institution_id (text), institution_name (text)
- status (enum: active, login_required, error)
- cursor (text, nullable) — for `/transactions/sync`
- access_token_ref (text) — **reference into Supabase Vault; the token itself is never stored in a normal column** (see Plaid Integration)
- created_at, updated_at

### Categories & ledger

**categories**
- id (uuid), household_id (FK households, nullable = system default)
- name, kind (enum: income, expense, transfer)
- parent_id (uuid, self-FK, nullable), icon, color
- is_archived (bool, default false)

**transactions** (the core ledger)
- id (uuid), household_id (FK households), account_id (FK accounts), category_id (FK categories, nullable)
- type (enum: income, expense, transfer)
- amount_cents (bigint), currency (text)
- description, merchant (text, nullable)
- date (date)
- notes (text, nullable)
- pending (bool, default false)
- source (enum: manual, scanned, imported)
- receipt_url (text, nullable) — R2 object key (private)
- plaid_transaction_id (text, unique, nullable) — dedup key for imports
- split_parent_id (uuid, self-FK, nullable) — for split transactions
- created_by (FK profiles), created_at, updated_at

### Budgets, bills, goals, debts

**budgets**
- id (uuid), household_id, category_id (FK categories)
- period (enum: weekly, monthly), amount_cents (bigint)
- rollover (bool, default false), start_date (date)
- created_at, updated_at
- "spent" is derived from transactions per period (not stored)

**recurring_rules** (recurring bills & income)
- id (uuid), household_id, account_id (FK accounts), category_id (FK categories)
- name, amount_cents (bigint), type (enum: income, expense)
- frequency (enum: weekly, biweekly, monthly, quarterly, yearly)
- next_due_date (date), end_date (date, nullable)
- auto_post (bool, default false) — whether due instances auto-create a transaction
- created_at, updated_at

**savings_goals**
- id (uuid), household_id, name
- target_amount_cents (bigint), target_date (date, nullable)
- linked_account_id (FK accounts, nullable) — if set, progress tracks that account's balance
- current_amount_cents (bigint, default 0) — used when not linked to an account
- color, icon, created_at, updated_at

**debts**
- id (uuid), household_id, name
- type (enum: credit_card, student_loan, mortgage, auto, personal, other)
- principal_cents (bigint), apr (numeric(5,2), nullable)
- minimum_payment_cents (bigint, nullable), due_day (int, nullable)
- linked_account_id (FK accounts, nullable), plaid_account_id (text, nullable)
- created_at, updated_at

### AI artifacts & usage

**monthly_summaries** (cached AI insight, parallels Roundtable's cached nutrition jsonb)
- id (uuid), household_id, month (date, first of month)
- summary (jsonb), model (text), created_at
- UNIQUE(household_id, month)

**ai_usage** — backs the per-user daily rate limiter (Postgres RPC), same pattern as Roundtable.

---

## Security Rules (Critical — Never Bypass)

### Row Level Security (RLS) — every table has RLS enabled
- All finance tables (`accounts`, `plaid_items`, `categories`, `transactions`, `budgets`,
  `recurring_rules`, `savings_goals`, `debts`, `monthly_summaries`) are readable/writable
  **only by members of the owning `household_id`**. The canonical predicate:
  `household_id IN (SELECT household_id FROM household_members WHERE user_id = auth.uid())`.
- `households` / `household_members`: readable by members; only the owner can rename/delete
  the household or manage membership.
- `categories` with `household_id IS NULL` (system defaults) are world-readable but never writable by users.
- `profiles`: a user may read/update only their own row.

### Database Table Checklist (every new table)
1. `ALTER TABLE x ENABLE ROW LEVEL SECURITY;`
2. Define **both** SELECT and write (INSERT/UPDATE/DELETE) policies before the task is "done"
   (a missing SELECT policy default-denies reads even when writes succeed).
3. Scope every policy to household membership.
4. Server Actions for all mutations — never client inserts.
5. Zod schema in `src/lib/validations/` for any form that writes.

### Money & data integrity
- Amounts are integer cents (`bigint`); never trust a client-supplied float — parse and convert server-side.
- Imports dedupe on `plaid_transaction_id`; never insert a Plaid transaction twice.
- All currency display goes through `formatCurrency()` in `src/lib/money.ts`.

### General security
- Never expose the Supabase **service role key** in client code.
- Validate/sanitize all inputs with Zod; never trust client-supplied user IDs — derive from the auth session.
- Env vars prefixed `NEXT_PUBLIC_` are browser-exposed — never put secrets there.
- Login is a server action, IP rate limited (**5 / 15 min / IP**); honeypot + time-based bot check.
- Registration IP rate limited (**5 / hour / IP**). Forgot-password (**3 / hour / IP**) always returns success (no enumeration).
- Passwords (server-side Zod): min 8, upper, lower, number, symbol.
- Email confirmation required before first login (`/auth/confirm` — PKCE + token_hash).
- All server-action errors that reach the client must be generic; log the real error server-side with a context prefix (e.g. `console.error("[transactions] ...", err)`). Never return a raw Supabase `error.message`.
- Open-redirect protection via `getSafeRedirect()`.
- Global security headers in `next.config.ts` (nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy). HSTS at the Cloudflare edge. Add a CSP in report-only first, then enforce.

---

## Plaid Integration (Bank Sync)

> Sequenced into **Phase 3** — ship a solid manual + receipt-scan ledger first, then add sync.
> Plaid carries the most sensitive secret in the app (a standing bank-read token); treat it accordingly.

### Plan & cost
Use the free **Trial plan** (US/Canada) for development and personal use — real production
data, capped at 10 connected Items (one Item = one bank login), bundling Transactions,
Balance, Liabilities, Auth, Identity, Investments, and Assets. A two-person household needs
only a handful of Items, so this stays free; if it ever exceeds the cap, **Pay-as-you-go**
(no minimum) is the upgrade. Start in **Sandbox** (`PLAID_ENV=sandbox`), then request
Production access.

### Connection flow (one-time, per bank)
1. Server action creates a **Link token** (`/link/token/create`) → returned to the client.
2. Client opens **Plaid Link** (`react-plaid-link`); user authenticates with their bank.
3. Link returns a short-lived **`public_token`** to the client.
4. Server action exchanges it (`/item/public_token/exchange`) → **`access_token` + `item_id`**.
5. **Store the `access_token` in Supabase Vault** (pgsodium) and keep only a Vault reference
   in `plaid_items.access_token_ref`. The raw token is read **only** server-side via the
   service-role client, never selected into a client payload, never logged.
6. Pull accounts (`/accounts/get`) and map them into `accounts` (set `plaid_item_id`,
   `plaid_account_id`, `is_manual=false`). Optionally backfill history (up to ~730 days).

### Ongoing sync (automatic)
- Plaid fires `SYNC_UPDATES_AVAILABLE` to `POST /api/plaid/webhook`. Verify the webhook JWT
  (`/webhook_verification_key/get`) before trusting the body — same raw-body discipline as the
  Stripe webhook handler.
- The handler calls **`/transactions/sync`** with the stored `cursor`, applies `added` /
  `modified` / `removed` deltas to `transactions` (dedup on `plaid_transaction_id`, honor the
  `pending` → posted transition), and persists the new cursor on `plaid_items`.
- Balances refresh via `/accounts/balance/get` into `accounts.current_balance_cents`.
- **Liabilities** (`/liabilities/get`) populate `debts` (credit cards, student loans, mortgages —
  APR, minimum payment, due dates) so debt entries can be auto-maintained.

### Re-auth & errors
- On `ITEM_LOGIN_REQUIRED` (banks periodically force re-auth), set `plaid_items.status='login_required'`
  and re-open Link in **update mode** for that item. Surface this clearly in `/accounts`.

### Households & Plaid
- The `access_token` belongs to whoever linked the bank, but the **resulting `accounts` and
  `transactions` are household-scoped** — both members see all of it. No per-account privacy in v1.

---

## AI Integration (Anthropic Claude API)

All model strings live in `src/lib/ai-models.ts` (`AI_MODELS.sonnet` / `AI_MODELS.haiku`) —
**never hardcode a model string at a call site** (models get retired; a stale string 404s).
All AI features are gated by the per-user daily rate limiter (`src/lib/rate-limit.ts`).

| Feature | Model | Notes |
|---|---|---|
| Receipt scanning | Sonnet | Photo/PDF → merchant, date, total, suggested category → prefilled transaction draft. Multi-image supported. |
| Statement / CSV import | Sonnet | Parse rows → structured transactions for review-then-bulk-insert. Prefer deterministic CSV parsing; use AI for messy formats. |
| Auto-categorization | Haiku | merchant+description → category. **Cache per-merchant** (DB) to avoid re-calling for repeat merchants. |
| Monthly insights | Sonnet | Plain-language summary (top categories, vs budget, trend vs last month, anomalies). Cached in `monthly_summaries`. |
| Finance assistant | Sonnet | Conversational Q&A grounded in a compact snapshot of household data. |

### Finance-assistant guardrails (bake into the system prompt)
- It is **informational only and not a licensed financial advisor**; for consequential
  decisions it recommends consulting a professional.
- It does **not** make specific securities/investment buy/sell recommendations.
- It answers from the provided household snapshot; it never fabricates figures.

---

## Cloudflare R2 (Private)

Unlike Round Table Recipes (public recipe-photo CDN), **receipts and statements are private**.
Upload via `POST /api/upload` (validate with the magic-byte `detectFileType()` helper —
JPEG/PNG/WebP/PDF; never trust client `file.type`). Store the object **key** in
`transactions.receipt_url`. Serve via short-lived **signed URLs** generated server-side and
scoped to household members — there is no public bucket URL. On replace/delete, call the R2
delete helper to avoid orphans.

---

## Feature Roadmap

### Phase 1 — Core ledger (PoC)
- [ ] Auth: register, login, email confirmation, forgot/reset password
- [ ] Household creation + invite-code join (the two adults)
- [ ] Accounts (manual): create/edit/archive, balances
- [ ] Categories: seeded defaults + custom
- [ ] Transactions: manual add/edit/delete, filters, split
- [ ] Dashboard: net worth, account balances, this-month income vs expense, recent activity
- [ ] Responsive + dark mode + PWA + security baseline + dev/prod Supabase split

### Phase 2 — Money features
- [ ] Budgets (per-category, monthly/weekly) + progress
- [ ] Recurring bills & income (auto-post option)
- [ ] Savings goals (manual or account-linked)
- [ ] Debt tracking (manual)
- [ ] AI receipt scanning → transaction draft
- [ ] AI auto-categorization + merchant cache
- [ ] Net worth rollup + basic charts

### Phase 3 — Bank sync & intelligence
- [ ] Plaid Link + token exchange + Vault storage
- [ ] `/transactions/sync` + webhook + cursor persistence
- [ ] Balance sync; Liabilities → debts
- [ ] Statement / CSV import
- [ ] Monthly AI insights
- [ ] Finance assistant chat
- [ ] Reports + CSV/PDF export

### Phase 4 — Mobile
- [ ] React Native + Expo app
- [ ] iOS / Google Play release

---

## Design Guidelines

- **Brand name**: Roundtable Finance (working title)
- **Tone**: Calm, trustworthy, clear — a private ledger, not a bank dashboard or a hype app
- **Numbers**: tabular figures (`font-variant-numeric: tabular-nums`); right-align amounts; income vs expense color-coded consistently
- **Mobile-first**: every layout must work on phones; sidebar collapses to a bottom tab/hamburger at `lg`
- **Accessibility**: semantic HTML + shadcn/ui accessible components; visible focus
- **Dark mode**: supported via next-themes from day one
- Keep UI simple — fast capture matters more than density
- Brand color: TBD (pick one accent; reserve red/green strictly for negative/positive money semantics so they don't compete with the brand accent)

---

## Git & Deployment

Commit directly to `main` during private use; `main` auto-deploys to Vercel on push.
Workflow: change locally → `npm run dev` → commit to `main` → push → Vercel deploys.
Vercel instant rollback is the safety net. **Never force-push `main`.**

**Commit message format:** `feat:`, `fix:`, `chore:`, `docs:`

---

## Environment Variables
```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=          # Supabase project URL (browser-safe)
NEXT_PUBLIC_SUPABASE_ANON_KEY=     # Supabase anon key (browser-safe)
SUPABASE_SERVICE_ROLE_KEY=         # Server only — never expose
NEXT_PUBLIC_SITE_URL=              # Canonical site URL (emails, redirects)

# AI
ANTHROPIC_API_KEY=                 # Claude API — server only

# Plaid (all server only)
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_ENV=                         # sandbox | production
PLAID_WEBHOOK_URL=                 # https://<domain>/api/plaid/webhook

# Cloudflare R2 (private bucket) — server only
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=

# Email (server only)
RESEND_API_KEY=
FROM_EMAIL=

# Cloudflare Turnstile
NEXT_PUBLIC_TURNSTILE_SITE_KEY=    # browser-safe
TURNSTILE_SECRET_KEY=              # server only
```

> Plaid `access_token`s are **not** environment variables — they are per-item secrets held in
> Supabase Vault and referenced from `plaid_items.access_token_ref`.

---

## Dev/Prod Supabase Split

- **Dev project** for local (`.env.local`); **Prod project** in Vercel. Never mix keys.
- Apply schema changes to **both** projects (test in dev, then run in prod SQL editor).

---

## Notes for Claude Code

- Commit directly to `main`; test with `npm run dev` before pushing.
- Always TypeScript — no `any` without explicit justification.
- Use the server-side Supabase client for data fetching in server components.
- **Every new table gets RLS + both SELECT and write policies, scoped to household membership, before the task is done.**
- **All money is integer cents (`bigint`); format only at the display edge.**
- Scope every finance query to the current household (`getCurrentHousehold()`); there is no public read path.
- Server Actions for all mutations — never direct browser client inserts.
- Use existing shadcn/ui components before building custom ones; keep files under ~150 lines.
- AI model strings come only from `src/lib/ai-models.ts`. AI features must check the per-user rate limiter.
- The Plaid `access_token` is never sent to the client, never logged, and only read server-side via the service-role client.
- Receipts/statements are private — store R2 keys, serve via short-lived signed URLs; never a public bucket URL.
- `"use server"` files may only export async functions — extract types to `src/lib/types/` and Zod schemas to `src/lib/validations/`.
- Use `router.refresh()` (not `window.location.reload()`) after a server action that revalidates.
- When in doubt about a feature, ask before building.
```
