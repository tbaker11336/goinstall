# GoInstall — Build Spec

Version: 20 October 2026 · Product name: **GoInstall**

**Designs:** the finished screen designs are in `docs/design/`. `docs/design/DESIGN.md` holds the colours, type, spacing, components and a list of the 16 screens. Each screen is in `docs/design/png/` (image) and `docs/design/html/` (reference markup). Match these designs when building the UI.

## Overview

Build a multi-tenant web console and installer mobile app that runs a solar, battery and EV charger installation business end to end: enquiry, survey, design, proposal, deposit, kit ordering, scheduling, install, paperwork and handover. This replaces the existing EV-only CRM built in Lovable and adds solar and battery design.

**Users**

- **Office team** (web console): sales, design, operations and admin staff at an installer company.
- **Installers and surveyors** (mobile app): field staff doing surveys and installs.
- **Customers** (no login): receive messages, fill in the online survey, view and accept proposals, pay deposits and sign off.

**Goals**

- One record per job from first enquiry to handover, with no re-keying between stages.
- Solar and EV design built in, so the company does not need a separate design tool (OpenSolar is a competitor, not an integration).
- Proposals generated from the design, kit orders generated from the proposal, paperwork pre-filled from survey and design.
- Two-way customer messaging (email and WhatsApp) inside the console.

**Reference:** every screen named in this spec is designed in `docs/design/` (see DESIGN.md). All names, prices and figures in the designs are demo data.

## Tech stack and architecture

Build on Vercel, Supabase and Resend, with an Expo app for installers, in one TypeScript monorepo. Customers and office staff use the web; only installers need an app. Supabase matches what Lovable generates, which makes migrating existing data straightforward.

| Layer | Choice | Notes |
| --- | --- | --- |
| Monorepo | pnpm workspaces + Turborepo | `apps/web`, `apps/installer`, `packages/core`, `packages/db`, `packages/integrations` |
| Web console + customer pages | Next.js (App Router), TypeScript, Tailwind, shadcn/ui on **Vercel** | Functions in London (`lhr1`); server actions for mutations |
| Database, auth, storage | **Supabase** Postgres, Auth, Storage | London (`eu-west-2`) for UK GDPR; RLS on every table by `company_id` |
| Scheduled and long jobs | Supabase cron + Edge Functions; Inngest or Trigger.dev when jobs need retries and steps | Supplier syncs, PDF batches, reminders: Vercel functions have time limits |
| Outgoing email | **Resend** | Proposals, reminders, notifications, handover packs, from each company's verified domain |
| Inbound email | Inbound email service to a webhook, or each company's Gmail/Outlook (OAuth) | Decide before phase 2 |
| WhatsApp | Meta WhatsApp Business Cloud API | One number per company; templates outside the 24-hour window |
| Installer app | **Expo** (React Native), EAS Build, Submit and Update | One codebase for iOS and Android; no Mac needed |
| Offline sync | PowerSync (built for Supabase) | Local copy of jobs; queued photos, readings, signatures |
| Payments | Stripe Connect | Each installer company paid directly |
| Accounting | Xero API | Invoices and payments sync |
| Calendars | Google Calendar and Microsoft Graph | Two-way sync of surveys and installs |
| Maps and roof data | Google Maps JS + Google Solar API | Keys server-side or domain-restricted; cache responses (billed per request) |
| Yield | PVGIS API + MCS calculation in `packages/core` | MCS figure is the one quoted |
| PDFs | React-PDF | Not a headless browser |

**How it connects:** the console and customer pages run on Vercel; the installer app syncs through PowerSync; everything reads and writes one Supabase database in London. Webhooks (Stripe, WhatsApp, inbound email, suppliers) land on Vercel routes, verify signatures, write to the database and hand slow work to a job. Scheduled jobs run from Supabase to suppliers and other services.

```
Installer app (Expo) ── PowerSync ──┐
Office console ──┐                  │
Customer pages ──┴── Vercel ────────┼── Supabase (London): Postgres + RLS, Auth, Storage, Cron
                      │             │
                      └── Third parties: Resend, WhatsApp, Stripe Connect, Xero,
                          Google Solar API, supplier APIs, calendars
```

**Rules for Claude Code**

- Multi-tenant from day one: every row carries `company_id`; RLS enforces it for web and app alike.
- All calculations (yield, cable sizing, volt drop, max demand, pricing) live in `packages/core` as pure, unit-tested functions shared by web and mobile.
- Every third-party integration sits behind an adapter interface in `packages/integrations`.
- Photos, signatures and PDFs go in private Supabase Storage buckets, served by signed URLs.
- Separate Supabase projects for development, staging and production; Vercel preview deployments point at staging.
- Secrets in environment variables or Supabase Vault, never in the client.

**Installer app specifics**

- EAS Update pushes fixes without store review; EAS Build and Submit handle store releases.
- Device features: camera, barcode scanning, signature capture, maps and navigation links, push notifications for new or changed jobs.
- Same Supabase login as the console; Installer and Subcontractor roles see only assigned jobs.
- One public store listing that every company's staff log into. Apple Developer ($99 a year) and Google Play ($25 once) accounts in the company name; Apple verification can take one to two weeks.

**Architecture decisions still open**

- [ ] Customer email replies: inbound service, or connect each company's Gmail/Outlook?
- [ ] Background jobs: Supabase cron only, or Inngest/Trigger.dev from the start?
- [ ] Offline sync: PowerSync, or a lighter custom sync queue?

## Data model

A contact can have many projects; a project holds one survey, one design per product type, proposals, orders, bookings and paperwork. All tables carry `company_id`, `created_at`, `updated_at` and `created_by`.

| Entity | Key fields | Relationships |
| --- | --- | --- |
| `companies` | name, logo, website, address, company no., VAT no., MCS no., competent person scheme no., brand colours, bank details, quote/invoice prefix, default deposit %, T&Cs | Tenant root |
| `users` | name, email, phone, role, team_id | Belongs to company |
| `teams` | name, members | Assigned to bookings |
| `contacts` | name, phone, email, address, source, stage, owner_id, tags, lost_reason | Has many projects, messages |
| `projects` | contact_id, site address, lat/lng, products (solar/battery/ev), stage, value, owner_id, target install month | Core job record |
| `surveys` | project_id, online_status, in_person_status, surveyor_id, scheduled_at, survey link token | Has many survey_fields, photos |
| `survey_fields` | survey_id, key, value, source (online / in_person / photo / staff_edit), edited_by | One row per field so source is tracked |
| `photos` | project_id, category (front, roof, consumer unit, meter, loft, charger spot, install step…), storage path, taken_by | Used by survey and install |
| `solar_designs` | project_id, roof segments (JSON), panel placements (JSON), obstructions, panel/inverter/battery product ids, kWp, strings, annual kWh (MCS), PVGIS kWh, self-consumption %, shade factor, version | One active per project |
| `ev_designs` | project_id, charger product id, mounting, tethered, supply point and charger positions, cable route (polyline), route length, install method, cable size, volt drop %, main fuse, phases, max demand, load management flag, earthing, solar divert flag, version | One active per project |
| `products` | category, make, model, specs (JSON), cost, sell price, supplier_id, supplier SKU, stock | Company catalogue |
| `suppliers` | name, connection type (api / price_file / email), credentials ref, last sync | Has many products, orders |
| `proposals` | project_id, version, line items (JSON), totals, deposit %, deposit amount, status (draft/sent/viewed/accepted/declined), sent/viewed/accepted timestamps, signature, public token | Generated from designs |
| `payments` | proposal_id, type (deposit/balance), amount, provider, provider ref, status | Stripe |
| `purchase_orders` | project_id, supplier_id, lines (JSON), status, expected delivery, delivery address | Drafted on deposit paid |
| `bookings` | project_id, type (survey/install/scaffold), team_id, start, end, status | Calendar sync |
| `checklist_items` | booking_id, step, required photo, completed_by, completed_at, test readings (JSON) | Installer app |
| `paperwork` | project_id, type (G98, G99, EV notification, MCS cert, electrical cert, warranty, handover pack), status, due date, submitted at, file path | Pre-filled from data |
| `messages` | contact_id, project_id?, channel (email/whatsapp/note), direction, body, attachments, provider message id, sent_by | Unified thread |
| `activity_log` | project_id, actor, event, payload | Feed on project overview |
| `integrations` | company_id, provider, status, tokens ref | Settings › Integrations |

## CRM: dashboard, contacts and messaging

The console's left sidebar holds Dashboard, Contacts, Projects, Proposals and Schedule, with Settings pinned to the bottom-left.

**Dashboard**

- Stat tiles: new enquiries, surveys due, proposals awaiting acceptance, kit to order, installs this week. Each tile links to a filtered list.
- Projects table: project (address), products, stage chip, next step. Filter chips by stage. Row click opens the project.
- Today panel: today's surveys, installs and events needing action (for example deposit received → order kit).
- Unread messages panel: latest unread email and WhatsApp messages, linking to the contact.
- "+ New enquiry" creates a contact and project in one form.

**Contacts list**

- Toggle between Kanban and list view; remember the choice per user.
- Kanban columns: New enquiry, Survey, Design, Proposal sent, Won (deposit paid), Lost. Dragging a card changes stage; moving to Lost asks for a reason.
- Card shows name, town/postcode, product tags, source and one status line.
- List view: sortable table with the same fields plus owner and last activity.
- Filters: search (name, address, phone, email), product, source, owner.
- Inbound web-form enquiries create contacts automatically via a public endpoint or embeddable form.

**Contact page**

- Left: details (phone, email, address, source, interested in), editable; list of the contact's projects.
- Right: one conversation thread with tabs All, Email, WhatsApp, Notes. Each message shows channel, time and sender.
- Composer: choose channel, write, attach files, insert templates, and a one-click "Send survey link" template.
- Inbound email and WhatsApp replies arrive by webhook and attach to the matching contact by email address or phone number. Unmatched messages go to an inbox for manual linking.
- System events (survey completed, proposal viewed, deposit paid) appear inline in the thread.

**Messaging rules**

- WhatsApp outside the 24-hour customer-service window must use pre-approved message templates; the composer must enforce this.
- Store every message, including outbound system messages, in `messages`.

## Projects and stage workflow

A project moves through nine stages; each move is triggered by an event, and most trigger automatic follow-up actions. Staff can move a stage back manually; every change is written to `activity_log`. Everything before the deposit is selling and can end in Lost; everything after it is delivery.

| Stage | Entered when | Automatic actions |
| --- | --- | --- |
| Enquiry | Contact and project created | Notify owner; optional auto-reply with survey link |
| Survey | Online survey sent or in-person survey booked | Reminder to customer after [n] days if online survey not done |
| Design | Survey marked complete | Roof data fetched for the site address |
| Proposal sent | Proposal sent to customer | Track views; reminder after [n] days |
| Accepted | Customer accepts and signs | Deposit payment link sent |
| Deposit paid | Stripe webhook confirms payment | Draft purchase orders from proposal; Xero invoice synced |
| Kit ordered | Purchase orders placed | Track delivery dates |
| Scheduled | Install booking confirmed with a team | Customer notified; calendar events created; paperwork due dates set |
| Paperwork / complete | Installer completes job in app | Balance invoice sent; certificates and DNO forms drafted; handover pack emailed |

A project can also be marked **Lost** from any stage before Deposit paid, with a reason.

**Project page**

- Header: site address, contact link, products, stage chip, back to dashboard.
- Tabs: Overview, Survey, Design, Proposal, Kit & suppliers, Install & paperwork. A tab shows a tick once its stage is done.
- Overview: a "Next step" card with the primary action for the current stage, the project journey checklist, contact card with "Message customer", key details (value, owner, target install month) and activity feed with a note input.

## Survey

A project can have an online survey, an in-person survey, or both; their answers merge into one set of fields that staff can edit, and every field records where its value came from.

**Online survey (customer-facing)**

- Public mobile-friendly form at a tokenised link; no login. Sent by email or WhatsApp from the contact page or the Survey tab.
- Questions configurable per company (Settings), with defaults for solar, battery and EV: annual usage, roof type and material, supply and main fuse, consumer unit, inverter/battery location, charger location and cable run, occupancy profile.
- Photo upload per required category, using the phone camera.
- Progress saved as the customer goes; on submit, the project shows "Online survey completed" and the owner is notified.

**In-person survey**

- Booked from the Survey tab: date, surveyor; creates a booking and notifies the customer.
- Captured in the installer app (see Scheduling, teams and installer app), pre-filled with online answers for checking.

**Survey tab (console)**

- Two cards: Online survey (status, resend link, edit questions) and In-person survey (status, book visit).
- Survey details grid: every field is an editable input with a source label: from online survey, from photo, from in-person survey, or edited by [user].
- Photo grid with required categories; missing ones are highlighted.
- "Mark survey complete → Design" moves the stage. Warn, but allow, if required fields or photos are missing.

## Solar design module

The Design tab opens a single workspace: the roof loads automatically from the project address, staff place panels on the aerial image, and results update live in a side panel. A Solar PV / EV charger switch sits at the top of the tab.

**Roof data**

1. Geocode the site address and call the Google Solar API (`buildingInsights`, plus `dataLayers` for the aerial image and shade data).
2. Create roof segments from the response: pitch, azimuth, area, plus the API's suggested panel layouts.
3. If the API has no coverage or low-quality imagery, fall back to the aerial map with a "Draw roof" tool: the user draws polygons and enters pitch and azimuth by hand.
4. Cache API responses per project; Google Solar API calls are billed.

**Layout canvas**

- Built on Google Maps JS with an overlay layer (or a canvas library such as Konva) for panels.
- Tools: Auto-fill roof, Add / remove panel, Mark obstruction (chimney, roof window, vent), Draw roof, view survey photos, shading heatmap toggle, zoom.
- Panels respect edge setbacks (configurable per company) and obstructions; portrait or landscape per segment.
- Roof segment chips show panel count per segment.

**Side panel**

- Equipment: panel, inverter (auto-matched to array size, overridable) and battery, picked from the company catalogue with live supplier price and stock where connected.
- Results: system size (kWp), annual generation (MCS figure), PVGIS cross-check, self-consumption %, EV miles from solar (when an EV design exists).
- Checks: flag when export capacity needs a G99 application rather than G98, and add the item to paperwork.
- "See full yield breakdown": monthly generation chart and per-array table (panels, kWp, pitch/azimuth, shade factor, kWh/yr).

**Calculations (packages/core)**

- MCS annual generation per array: kWh/kWp lookup by postcode zone, pitch and orientation, multiplied by kWp and shade factor. Store the lookup tables as versioned data files.
- Self-consumption from the MCS occupancy archetype, with and without battery.
- PVGIS `PVcalc` call per array for the monthly profile.
- String sizing and DC/AC ratio from panel and inverter specs.
- All functions unit-tested against worked examples supplied by the business.

**Saving**

- Autosave; each change produces a new version and "Create proposal from design" uses the latest. Earlier versions are viewable.

## EV charger design module

The EV charger view of the Design tab places the supply point and charger on a site plan, draws the cable route between them, and checks supply, cable and earthing before quoting.

**Site plan**

- Background: aerial image (Google Maps) or a survey photo, switchable.
- Tools: Place charger, Place supply / consumer unit, Draw cable route (polyline), Set route type per segment (clipped to wall, in conduit, buried).
- Positions and route length are pre-filled from survey answers where given; route length is measured from the polyline and editable.

**Side panel**

- Charger: model from catalogue, mounting (wall / post), tethered or socket.
- Supply and load: main fuse rating and phases (from survey), maximum demand with the charger added, and whether load management is needed.
- Earthing and protection: earthing arrangement and the protection method chosen.
- Cable: route length and install method; cable size and volt drop calculated automatically, with a pass/fail against the limit.
- Solar link: "Charge from surplus solar" toggle, linked to the solar design.
- Checks: DNO notification added to paperwork automatically; warning when the main fuse may need upgrading.

**Calculations (packages/core)**

- Maximum demand, cable sizing and volt drop follow the business's installation standards. Claude Code must implement these as configurable, unit-tested functions and must not invent the rule values: the business supplies the tables and limits (see Open questions).

## Proposals, deposits and invoices

One proposal covers every product on the project; it is generated from the active solar and EV designs, sent by email and WhatsApp, accepted online, and paying the deposit drafts the kit order.

**Building the proposal**

- Line items grouped by section (Solar PV, Battery, EV charging, Labour and extras), pre-filled from designs at catalogue sell prices; staff can edit, add from catalogue or add custom lines.
- Shared-visit discount line when solar and EV are installed together (configurable).
- Totals: subtotal, VAT at the configured rate, total, deposit % and amount.
- Customer-facing summary: roof render with layout, annual generation, estimated yearly saving, payback, EV miles from solar.
- Branded with company logo, colours and T&Cs from Settings. Versioned: editing after sending creates a new version.

**Customer view (public link)**

- Mobile-friendly web page with PDF download.
- Accept: typed name and drawn signature, timestamp and IP stored.
- After acceptance, pay deposit via Stripe Checkout on the same page.

**Status tracking**

- Sent (channels used), viewed (count, last viewed), accepted and signed, deposit paid. "Send reminder" button and automatic reminders.

**Payments and invoices**

- Stripe webhook marks the deposit paid and moves the stage.
- Deposit invoice and, on completion, balance invoice with payment link; both synced to Xero with payments reconciled.
- Bank transfer shown as an alternative using company bank details.

## Products, kit ordering and supplier integrations

Every product used in designs, proposals and orders comes from the company catalogue, which is filled by hand, by CSV upload or by syncing a connected supplier; kit is ordered per supplier from the Kit & suppliers tab.

**Supplier adapter interface (packages/integrations/suppliers)**

Each supplier implements one adapter with three connection types:

| Connection type | Prices and stock | Placing orders | Order status |
| --- | --- | --- | --- |
| API | Scheduled sync + on-demand lookup | Submitted via API | Polled or webhook |
| Price file | CSV / Excel upload with column mapping | PO PDF emailed to supplier | Updated manually |
| Email only | Manual entry | PO PDF emailed to supplier | Updated manually |

Adapter methods: `syncCatalogue()`, `getPriceAndStock(skus)`, `placeOrder(po)`, `getOrderStatus(poId)`. Build the price-file and email adapters first; add API adapters per supplier as access is agreed.

**Kit & suppliers tab**

- Kit list generated from the accepted proposal's designs: item, quantity, and a price column per connected supplier showing price and stock or lead time.
- Default selection per line: cheapest in stock; staff can override per line.
- Kit cost total and margin against the proposal.
- "Place orders" splits lines into one purchase order per supplier, with delivery address (site or depot) and expected date. Orders listed with status.
- Side panel: supplier connections with status and "+ Connect a supplier".

**Catalogue (Settings › Products & suppliers)**

- Table: product, category, supplier, cost, sell price; add, edit, archive.
- CSV upload with a column-mapping step and a preview before import.
- Product specs (JSON by category) feed the calculations: panel Wp, dimensions, Voc/Isc; inverter AC rating and MPPT ranges; battery capacity; charger rating.

## Scheduling, teams and installer app

The office books installs and assigns teams in the console; assigned jobs appear in the installer app, where field staff run surveys, installs and customer sign-off, and their results flow back into the project.

**Install & paperwork tab (console)**

- Week calendar showing the team's bookings; drag to place a multi-day job. Separate booking types for install, scaffold up and scaffold down.
- Assign install team, electrician (sign-off) and scaffolder (subcontractor).
- Clash warnings for double-booked teams.
- "Ready to install?" checklist: deposit paid, kit delivered, DNO approval (when required before install), customer confirmed date.
- "Confirm booking & notify customer" sends confirmation and syncs to the team's calendars.
- Global Schedule page (sidebar) shows all teams across all projects.

**Installer app (Expo)**

1. **My jobs:** day strip for the week; cards for each survey and install (time, address, type, products, readiness notes). Bottom tabs: Jobs, Messages, Van stock, Profile.
2. **Job details:** Navigate, Call, WhatsApp and "On my way" (sends the customer an ETA message). Design view (roof layout and EV cable route), kit check with "Report missing / damaged item", notes from the office, "Start install".
3. **Site survey:** guided photo checklist using the camera, survey fields pre-filled from the online survey, voice dictation for notes, progress bar; submit syncs to the Survey tab.
4. **Install checklist:** steps grouped by product, each needing photo evidence; serial number scanning (barcode); test result inputs that feed certificates and the MCS pack; progress bar.
5. **Customer sign-off:** handover checklist (monitoring app set up, charger paired, shown isolation, site clean), customer signature and printed name, "Complete job".

**Offline and sync**

- Jobs, designs and checklists download to the device each morning and when opened.
- All captures (fields, photos, signatures) save locally first and upload when online; show a sync status indicator.
- Conflicts: last write wins per field, with the overwritten value kept in history.

**Completing a job** sends the balance invoice with payment link, drafts certificates and DNO forms in the console, and emails the handover pack.

## Paperwork

Each project gets a paperwork checklist generated from its products and design, with forms pre-filled from company, survey, design and install data; staff review, generate and mark each item submitted.

| Item | Added when | Timing | Pre-filled from |
| --- | --- | --- | --- |
| G98 notification or G99 application | Solar/battery design saved (G99 flagged by design checks) | G99 before install; G98 after | Company, site, inverter and battery specs, export capacity |
| EV charger DNO notification | EV design saved | After install | Charger specs, supply details, site |
| MCS certificate | Solar design saved | After commissioning | Design, yield, installer test results |
| Electrical installation certificate | Any install | After install | Test readings from installer app |
| Warranty registrations | Products on proposal | After install | Serial numbers scanned in app |
| Customer handover pack | Any install | On completion | Design, certificates, manuals, warranty details |

- Each item has status (To do, Submitted, Awaiting response, Approved, Done), due date and attached files.
- "Generate all forms" produces PDFs; where a DNO or scheme offers an online portal, store the reference and link rather than automating submission in phase 1.
- Exact form fields per DNO and scheme are supplied by the business (see Open questions).

## Settings and integrations

Settings is pinned to the bottom-left of the sidebar and has five sections; only Admins can change them.

**Company details:** logo upload, company name, website, phone, email, registered address, company and VAT numbers, MCS certification number, competent person scheme number. Used on proposals, invoices, emails and paperwork.

**Invoices & quotes:** brand colours, quote/invoice number prefix, default deposit %, bank account name, sort code and account number, payment terms, T&Cs, and a preview of the proposal template.

**Integrations:**

| Integration | Purpose | Auth |
| --- | --- | --- |
| Google / Outlook calendar | Two-way sync of surveys and installs to team calendars | OAuth per user |
| Xero | Sync invoices, deposits and payments | OAuth per company |
| Stripe | Deposit and balance payments | Stripe Connect per company |
| WhatsApp Business | Send and receive customer messages | Meta Cloud API, per company number |
| Gmail / Outlook email | Send and receive from contact pages | OAuth per user or shared mailbox |

**Products & suppliers:** see Products, kit ordering and supplier integrations.

**Team & permissions:** invite users, set roles, create teams.

Also configurable here: online survey questions, required photo categories, install checklist steps, message templates, stage reminder timings, panel edge setbacks.

## Roles, security and non-functional requirements

Four roles, enforced by Postgres row-level security and checked again in server actions.

| Role | Can |
| --- | --- |
| Admin | Everything, including Settings, integrations, users and pricing |
| Office | Contacts, projects, surveys, designs, proposals, orders, scheduling, paperwork; no Settings |
| Installer | Installer app only: assigned jobs, survey capture, checklists, sign-off; read-only project info for those jobs |
| Subcontractor | Installer app for assigned bookings only; no prices |

**Security and data**

- UK GDPR: customer data export and deletion on request; retention policy configurable.
- Public links (survey, proposal) use unguessable tokens, expire, and expose only that project's customer-facing data.
- Webhooks (Stripe, WhatsApp, email, suppliers) verify signatures.
- Photos and documents in private storage buckets, served by signed URLs.
- Audit trail for stage changes, price edits, proposal versions and paperwork submissions.

**Quality**

- Console works on desktop and tablet; customer pages and installer app are mobile-first.
- Accessibility: WCAG 2.2 AA for console and customer pages.
- Unit tests for every calculation in `packages/core`; integration tests for stage transitions; end-to-end tests (Playwright) for enquiry → proposal accepted → deposit paid.
- Seed script with a demo company, products and three sample projects at different stages.

## Build phases and acceptance criteria

Build in six phases; each ends with a working, deployable product and the acceptance criteria below passing. Claude Code should finish and confirm each phase before starting the next.

1. **Foundations and CRM**
   - Monorepo, Supabase schema with RLS, auth, roles, Settings › Company details and Team.
   - Dashboard, contacts Kanban and list, contact page with notes, projects with stages and Overview tab.
   - Migration script importing contacts and jobs from the Lovable app.
   - Accept: a new enquiry can be created, moved across Kanban stages, and opened as a project; users of one company cannot see another's data.
2. **Messaging and survey**
   - Email and WhatsApp send and receive in the contact thread; message templates.
   - Online survey form, Survey tab with merged fields, sources and photos.
   - Accept: a customer receives a WhatsApp survey link, completes it on a phone, and the answers and photos appear on the Survey tab with sources.
3. **Products and design**
   - Product catalogue with CSV import; supplier records (price-file and email adapters).
   - Solar design (Google Solar API, layout canvas, MCS and PVGIS) and EV design (site plan, cable route, checks).
   - Accept: for a covered UK address, auto-fill produces a layout and an MCS annual figure that matches a worked example to within rounding.
4. **Proposals and payments**
   - Proposal builder, branded PDF, public accept and sign page, Stripe deposit, Xero sync.
   - Accept: end-to-end test from design to deposit paid passes, and the stage moves automatically.
5. **Kit, scheduling and installer app**
   - Kit list with supplier comparison and purchase orders; calendar and team booking; calendar sync.
   - Installer app: jobs, job details, survey capture, install checklist, sign-off, offline sync.
   - Accept: an installer completes a job offline in airplane mode, reconnects, and photos, readings and signature appear in the console.
6. **Paperwork and supplier APIs**
   - Paperwork checklist and generated PDFs; balance invoice and handover pack on completion.
   - First supplier API adapter once access is agreed.
   - Accept: completing a job produces the correct paperwork items with fields pre-filled.

## Open questions

These need answers from the business before or during the phase shown; Claude Code should ask rather than assume.

- [ ] Is this sold to other installers (multi-tenant SaaS) or used only in-house? The spec assumes multi-tenant. (Phase 1)
- [ ] What data and schema does the current Lovable app hold, and what must be migrated? (Phase 1)
- [ ] Which suppliers come first, and which offer an API? (Phase 3)
- [ ] MCS worked examples and lookup tables to test the yield calculation against. (Phase 3)
- [ ] EV design rules: maximum demand method, cable sizing tables, volt drop limit, earthing options. (Phase 3)
- [ ] Default deposit %, VAT treatment, and payment terms. (Phase 4)
- [ ] Install checklist steps and test readings required per product. (Phase 5)
- [ ] Which DNOs are covered, and the exact form fields for each paperwork item. (Phase 6)
- [ ] Should the installer app be on both iOS and Android from launch?
