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
| `packages/db` | Database tests: tenant isolation, roles, stage rules |
| `packages/integrations` | Adapter interfaces for third-party services |
| `supabase/migrations` | Postgres schema and row-level security |

## Running tests

Requires Node 22, pnpm and a Postgres 15+ server you can create databases on.
The database tests create a throwaway database, load a small stand-in for
Supabase's `auth` schema, apply every migration and run as real users through
RLS, so Docker and the Supabase CLI are not needed.

```sh
pnpm install
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
```

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
