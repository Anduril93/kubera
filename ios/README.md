# Roundtable Finance — iOS

Native SwiftUI client (iOS 26+, Swift 6) for the household finance app. It talks
to the same Supabase project as the Next.js web app.

## Setup

```bash
ios/scripts/write-secrets.sh        # writes ios/Config/Secrets.xcconfig from .env.local
open ios/Kubera.xcodeproj
```

`Secrets.xcconfig` is gitignored and only holds the browser-safe Supabase host +
anon key. Point it at the dev or prod project by passing a different env file:
`ios/scripts/write-secrets.sh path/to/.env.production`.

Command-line build and tests:

```bash
cd ios
xcodebuild test -project Kubera.xcodeproj -scheme Kubera \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

The project uses folder-synchronized groups: any file added under `Kubera/` or
`KuberaTests/` is part of the target automatically — no project-file edits.

## Backend requirements

The app writes to Supabase directly with the user's JWT, so the database is the
security boundary. It requires:

- Migrations through `0012` (`0011` hardens RLS/RPCs for direct clients, `0012`
  creates the private `receipts` Storage bucket).
- The `scan-receipt` Edge Function, with `ANTHROPIC_API_KEY` set as a function
  secret: `supabase secrets set ANTHROPIC_API_KEY=… --project-ref <ref>`.

## Layout

| Folder | Contents |
|---|---|
| `Kubera/App` | Entry point, launch gating (login → onboarding → tabs), tab bar, More menu |
| `Kubera/Core` | Supabase client, `AppModel` (session, household, reference data), toasts |
| `Kubera/Models` | Row types, enums, `CalendarDate` (Postgres `date` without time zones) |
| `Kubera/Logic` | Pure money/fiscal/budget/recurring/payoff/goal math, ported from `src/lib/*-meta.ts` |
| `Kubera/Data` | One API namespace per domain (queries, RPCs, storage, Edge Function) |
| `Kubera/UI` | Design tokens and shared components (`MoneyText`, `Pill`, `ProgressBar`, `Card`, …) |
| `Kubera/Features` | Screens: Dashboard, Transactions (+ receipt scan, split), Budgets, Accounts, Bills, Goals, Debts, Household |
| `KuberaTests` | Swift Testing suites for `Logic/` |

## Conventions

- Money is `Int` cents end to end. Parse input with `Money.parse` (exact decimal
  rounding), display with `Money.format` / `MoneyText`.
- Ledger writes go through RPCs (`create_transaction`, `update_transaction`,
  `delete_transaction`, `split_transaction`, `post_recurring_rule`) — direct
  writes to `transactions` are revoked so balances stay in step with the ledger.
- After a successful write call `app.didMutate()`; screens reload via
  `.task(id: app.dataVersion)`.
- Never show raw database errors. Use `userMessage(for:context:fallback:)`, or
  throw `DisplayableError` for copy that's safe to show.
- UUIDs that become part of text the database compares (storage paths, receipt
  keys) use `uuid.lower` — Postgres renders UUIDs lowercase.
