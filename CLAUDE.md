# goinstall

Build spec: `docs/SPEC.md`. UI designs: `docs/design/` (match `png/`, take
spacing and colours from `html/`, tokens in `DESIGN.md`); agreed schema:
`docs/DATA-MODEL.md`. Build in the phases it lists; finish and confirm
each phase before starting the next. Ask the business about anything listed
under Open questions rather than assuming (especially MCS tables and EV
design rules: never invent rule values).

## Decisions from the business

- WhatsApp is deferred (October 2026): don't build or show it until asked.
  The `whatsapp` message channel stays in the schema for later.
- Email sends through Resend from `EMAIL_FROM` with the company's name;
  replies go to the sending staff member (reply-to). Inbound email later.
- Install checklists: GoInstall drafts starter steps (marked as drafts,
  editable in Settings); test readings have no default values.
- Installer app: iOS and Android from launch (one Expo codebase).
- Surveys: EV chargers and solar & battery are separate surveys, each with
  its own questions, photos, link and status (`survey_kind`); a project with
  both gets two.
- Paperwork (phase 6): DNO forms follow the ENA standard forms (G98 Form A,
  G99, Connect Direct EV/heat pump); store the DNO reference and portal link,
  no automated submission. MCS: a pre-filled summary to copy into the MCS
  Installation Database, then store the certificate number and PDF. EIC: a
  test-readings sheet for the electrician's certificate software, then upload
  the signed EIC. No supplier API adapter until access is agreed.
- Notifications: in-app, email and SMS, internal (team) and external
  (customer). Each company picks channels per event in Settings ›
  Notifications; customer reminder timings are off until the company sets
  them.
- SMS is a paid add-on: a Stripe subscription on GoInstall's account
  (monthly fee plus a text allowance, extra texts on the next invoice) and
  the company's own UK number on a Twilio subaccount. Prices come from
  `SMS_PLAN_*` env settings: never invent them. GoInstall staff
  (`PLATFORM_ADMIN_EMAILS`) attach the number at `/platform/sms` once
  Twilio approves the business.
- Installers accept or decline each job in the app (a decline needs a
  reason); the office sees answers on the Schedule and is notified. Moving
  a job asks again. Installers don't create bookings themselves.
- Office ↔ installer messages are per job (app Messages tab, project Install
  tab) and never reach the customer.
- Push notifications: the "In-app" channel also pushes to the phones of
  people signed in to the installer app (Expo push). Needs the app linked to
  an Expo project (EAS) before phones can register.
- General electrical work: the "electrical" product. The job is described in
  words (`projects.work_description`), not job-type drop-downs. Electrical-only
  projects have no survey or design step for now; notes, photos and drawings
  go on the project as attachments, and proposals are built by hand.
- Job length is flexible: a project has an estimated length in hours, working
  days or working weeks, and installs are booked the same way (hours are timed
  from a start time). Any number of engineers can be put on a booking (role
  `engineer`), alongside the team and the electrician sign-off.
- Scaffold up/down bookings are for solar projects only.
- Terms and conditions: text and/or a PDF in Settings › Terms & conditions,
  attached to every proposal (and its email) and accepted on signing.
- Proposal template (Settings › Proposal template): a front cover and
  pages around the quote (About us, reviews, featured work, accreditations,
  custom text), ordered and switched on by the company; empty pages are left
  out. Drafts use the current template; sent proposals keep theirs.
- Schedule: one calendar (day / week / month) with a team filter; clicking a
  booking shows it with Reschedule and Notify customer.
- Project tabs: Schedule (bookings written like calendar invites: type,
  title, when, where, guests, description; any booking type incl. "Other
  visit") and Handover (installer photos, checklist readings, electrical
  test results, office uploads, paperwork, generate and send the pack).
- Invoices: a project Invoices tab (and an Invoices page across projects)
  once the quote is accepted: deposit, stage payments, balance and extra
  work; PDF, email with pay link, record payment, void.
- Electrical test results: per distribution board, the fields of the EIC
  continuation sheet (circuit details and test results); installers fill
  them in the app, the office can edit; values are text, nothing pre-filled.
- Sign-up: production runs with `SIGNUP_EMAIL_CONFIRMATION=off` for now
  (internal use): accounts are created confirmed and signed straight in.
  Remove it before opening sign-ups to other installers.
- Calendar sync: a private iCal feed link per team (Google, Outlook and
  Apple subscribe to it). Next: each person can connect Google Calendar and
  their bookings are pushed to it (option A; busy times later).
- Xero (November 2026): each company connects its own organisation in
  Settings › Integrations. Invoices go to Xero when raised (approved by
  default, or draft), with payments and voids; payments made in Xero come
  back daily or on "Check Xero for payments". Account codes and tax types are
  chosen by the company from its own Xero. Needs `XERO_CLIENT_ID`,
  `XERO_CLIENT_SECRET` and `INTEGRATION_TOKEN_KEY`; granular scopes
  (`XERO_SCOPES` overrides them).

## Environments

- Staging: Vercel `goinstall-staging` (functions in Dublin, `dub1`) on the
  Supabase project in eu-west-1. Production: Vercel `goinstall-production`
  at https://app.goinstall.io (functions in London, `lhr1`) on a London
  (eu-west-2) Supabase project. Regions are set per Vercel project, not in
  `vercel.json`. Production starts empty: no demo seed.

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
