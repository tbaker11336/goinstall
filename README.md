# goinstall

Multi-tenant platform for solar, battery and EV charger installers: enquiry,
survey, design, proposal, deposit, kit ordering, scheduling, install,
paperwork and handover. The full build spec is in [docs/SPEC.md](docs/SPEC.md).

## Layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js office console and customer pages (Vercel) |
| `apps/installer` | Expo installer app |
| `packages/core` | Pure, unit-tested business logic shared by web and app (stages now; yield, cable sizing, pricing later) |
| `packages/db` | Typed database client (`withUser`), migrations runner, demo seed, RLS tests |
| `packages/integrations` | Adapter interfaces for third-party services |
| `supabase/migrations` | Postgres schema and row-level security |

## Local development

Requires Node 22, pnpm and a Postgres 15+ server you can create databases on.
Docker and the Supabase CLI are not needed: a small stand-in for Supabase's
`auth` schema is loaded instead, and the console has a dev-only sign-in.

```sh
pnpm install
pnpm --filter @goinstall/db reset-dev        # creates goinstall_dev with demo data
cp apps/web/.env.example apps/web/.env.local  # DEV_AUTH=true for local sign-in
pnpm --filter @goinstall/web dev              # http://localhost:3000
```

Demo users (pick one on the dev sign-in page): Alex Morgan (admin), Priya
Shah (office), Dan Hughes (installer), Lee Carter (subcontractor), and Sam
Wright (admin of a second company, to check isolation).

After changing a migration, run `reset-dev` and then
`pnpm --filter @goinstall/db codegen` to regenerate `packages/db/src/schema.ts`.

## Tests

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test   # unit + RLS
pnpm typecheck
cd apps/web && pnpm e2e    # Playwright; set PG_ADMIN_URL if not the default above
```

## How the console talks to the database

Server components and server actions query Postgres directly (Kysely over
`pg`), not through PostgREST. Every query made for a signed-in user runs in a
transaction as the `authenticated` role with that user's JWT claims
(`withUser` in `packages/db`), so the same RLS policies apply as for the
Supabase API. On Vercel, `DATABASE_URL` is the Supavisor transaction pooler.
Supabase Auth handles sign-in; `DEV_AUTH` replaces it locally and is ignored
in production builds and on Vercel.

## Tenancy and security model

- Every tenant row has `company_id`; RLS restricts every query to the caller's
  company. Foreign keys between tenant tables are composite
  `(company_id, id)`, so rows can never reference another company's data.
- Roles: `admin`, `office`, `installer`, `subcontractor`. Installers and
  subcontractors get access to assigned jobs only, once bookings exist
  (phase 5); until then they see no CRM data.
- `activity_log` is append-only for staff. Project creation and every stage
  change are logged by trigger, whoever makes them.
- Anonymous users have no table access. Public customer pages go through
  server routes that check the link token.
