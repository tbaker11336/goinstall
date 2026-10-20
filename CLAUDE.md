# goinstall

Build spec: `docs/SPEC.md`. Build in the phases it lists; finish and confirm
each phase before starting the next. Ask the business about anything listed
under Open questions rather than assuming (especially MCS tables and EV
design rules: never invent rule values).

## Conventions

- Schema changes are new files in `supabase/migrations/` (timestamp prefix);
  never edit a migration that has been applied to a hosted project.
- Every tenant table: `company_id` (default `private.current_company_id()`),
  `created_at`, `updated_at` (trigger), `created_by`, RLS enabled, composite
  FKs `(company_id, x_id)` to other tenant tables, and policies using
  `(select private.current_company_id())` and `private.has_role(...)`.
- Add RLS tests in `packages/db/test` for every new table.
- Calculations and workflow rules live in `packages/core` as pure functions
  with unit tests. Keep `packages/core/src/stages.ts` in step with the
  `project_stage` / `contact_stage` enums.
- Third-party services sit behind adapters in `packages/integrations`.
- Secrets in environment variables or Supabase Vault, never in client code.

## Commands

- `pnpm test`: needs `DATABASE_URL` pointing at a Postgres superuser
  connection (default `postgres://postgres:postgres@localhost:5432/postgres`).
- `pnpm typecheck`
- `pnpm --filter @goinstall/db reset-dev` then `pnpm --filter @goinstall/db codegen`
  after schema changes.
- `cd apps/web && pnpm e2e` (here: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`).

## Web console

- Next.js 16 (read `apps/web/node_modules/next/dist/docs` before using an API;
  middleware is `proxy.ts`, request APIs are async).
- Read and write for users only through `asUser()` in `apps/web/lib/auth.ts`
  (RLS applies). `withService` is for onboarding, webhooks and public routes
  that have done their own checks.
- UI components follow shadcn/ui layout in `components/ui`; keep forms
  accessible (labels, keyboard alternatives to drag and drop).
