# scripts/

Verification harnesses used to validate the Supabase migrations and data layer
against the **dev** Supabase project. They are development tools, not part of the
app runtime.

## Requirements

- A `.env.local` at the repo root (gitignored) with the dev project's
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
  `SUPABASE_SERVICE_ROLE_KEY`. The scripts read these at runtime — **no secrets
  are hardcoded**.
- The corresponding migration already applied to the dev project.

Run from the repo root so the relative `.env.local` path resolves:

```bash
node scripts/verify-0007.mjs
```

## ⚠️ Destructive / dev-only

These scripts create and then delete throwaway auth users (and their data) via
the Supabase Admin API using the service-role key. **Never point them at a
production project.** Each script cleans up the users it creates on completion.

## Contents

- `verify-0006.mjs` — budgets: spend counting rule, fiscal/weekly periods, CRUD, RLS.
- `verify-0007.mjs` — recurring rules: idempotent posting, balance consistency, month-end advancement, overdue/upcoming, CRUD, RLS.
- `budget-ui-setup.mjs` — seeds a household + budgets + transactions for manual UI checks (`node scripts/budget-ui-setup.mjs`; `... delete` to tear down).
- `verify-budgets-ui.mjs` — verifies the server-rendered `/budgets` page via an authenticated request.
