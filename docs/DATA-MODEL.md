# Data model

Agreed design for the full schema, by build phase. Phase 1 tables exist in
`supabase/migrations/`; later tables are added as new migrations in their
phase. Where this differs from the data model table in `SPEC.md`, this file
wins.

## Rules for every table

- `company_id` (default `private.current_company_id()`), RLS by company and
  role, composite foreign keys `(company_id, x_id)` between tenant tables.
- `id` uuid, `created_at`, `updated_at` (trigger), `created_by`; `legacy_id`
  on tables imported from Lovable.
- Money as integer pence (`bigint`), never floating point.
- Tables the installer app syncs (PowerSync) use soft deletes (`deleted_at`)
  and accept client-generated uuids.
- Public link tokens (survey, proposal) are stored hashed, with an expiry.

## Tables

| Phase | Table | Notes |
| --- | --- | --- |
| 1 | `companies`, `users`, `teams`, `contacts`, `projects`, `messages`, `activity_log`, `integrations` | Built. Unmatched inbound messages have no contact (the manual-link inbox) |
| 2 | `message_templates` | Email and WhatsApp; WhatsApp templates carry Meta approval status |
| 2 | `surveys` | One per project per `kind` (`solar_battery`, `ev`: separate surveys, business decision); online and in-person status, surveyor, hashed link token |
| 2 | `survey_questions` | Per-company configurable questions per survey kind (and optionally per product within it) |
| 2 | `survey_fields` | Current value per key, with source and editor |
| 2 | `survey_field_history` | Every overwritten value (offline conflicts: last write wins, history kept) |
| 2 | `photo_categories` | Per-company required photo types per survey kind |
| 2 | `files` | All stored objects (photos, signatures, PDFs, attachments): bucket path, type, uploader; other tables reference it |
| 3 | `products` | Company catalogue: category, make, model, specs JSON, sell price |
| 3 | `suppliers` | Connection type, credentials reference, last sync |
| 3 | `supplier_products` | Cost, stock, lead time and SKU per supplier per product (replaces `products.supplier_id` in the spec, so the Kit tab can compare suppliers) |
| 3 | `roof_data_cache` | Google Solar API responses per project, so each billed call is made once |
| 3 | `solar_designs`, `ev_designs` | Append-only versions; one active per project (partial unique index); geometry as JSON. Solar designs also keep `site_markup` (equipment markers, cable runs, measurements on the plan) and `string_plan` (MPPT input per hand-wired string; panels carry their string number) (added in build) |
| 3 | `product_library` | Shared reference products (no `company_id`; read by everyone signed in, written only by the loader). First source: the CEC PV module list via NREL SAM. `products.library_id` records where a catalogue product was copied from (added in build) |
| 3 | `calc_tables` | Versioned MCS lookup and EV rule tables supplied by the business |
| 4 | `proposals` | Versioned; locked once sent (edits create a new version); status, totals, deposit, signature, hashed public token |
| 4 | `proposal_lines` | One row per line (replaces line-item JSON in the spec), for price-edit audit and kit generation. Each line has its own `vat_rate`: the proposal design charges VAT on EV lines only (0% solar and battery), so one rate per proposal is not enough. Rates come from company settings, not hard-coded (VAT treatment is an open question) |
| 4 | `proposal_views` | Each customer view |
| 4 | `invoices` | Deposit and balance invoices with Xero reference (not in the spec) |
| 4 | `payments` | Stripe payments against an invoice |
| 5 | `kit_items` | Kit list per project from the accepted proposal; per-line supplier override (null = cheapest in stock); no prices, so installers can check kit (added in build) |
| 5 | `purchase_orders`, `purchase_order_lines` | One order per supplier |
| 5 | `bookings` | Survey, install, scaffold up/down, and a general `task` type (the My jobs design shows "Collect from depot") |
| 5 | `booking_assignments` | Team, electrician and scaffolder per booking; drives installer and subcontractor access |
| 5 | `checklist_templates`, `checklist_items` | Per-company steps; completed items carry photo, readings and serials. Item ids are made on the device so offline sync is idempotent |
| 5 | `checklist_item_history` | Overwritten checklist values (last write wins, history kept) (added in build) |
| 6 | `paperwork_items` | One row per paperwork item per project (one per product for warranty registrations), generated from the design and install by `packages/core/src/paperwork.ts`; status, due date (rule-set until staff change it), DNO/scheme reference, portal link, staff-entered form values. Files attach via `files.paperwork_item_id`. `projects.mpan` holds the site MPAN. Balance invoices carry a hashed pay link (`invoices.pay_token_hash`) (added in build) |
| 6 | `paperwork` | Type, status, due date, reference, generated file |
| 7 | `notifications` | In-app notifications per staff member (the bell and the installer app's Alerts tab). Written only by the server; a user can read theirs and mark them read (added in build) |
| 7 | `notification_log` | One row per customer reminder step sent (event, entity, step), so the daily reminders job never sends one twice (added in build) |
| 7 | `sms_accounts` | The SMS add-on per company: Stripe subscription on GoInstall's account, status, the company's own UK number (Twilio subaccount), texts used this period. Written by the server; admins can read it. `companies.notification_settings` holds the event × channel choices and reminder timings (off until set); `contacts.sms_opt_out_at` records STOP; `messages.sms_segments` counts billable texts; `surveys.link_nonce` lets a reminder resend the same link (added in build) |

## Access rules

- Prices live only in tables subcontractors cannot select
  (`proposal_lines`, `supplier_products`, `invoices`, `payments`,
  `purchase_order_lines`, product prices), rather than hiding columns.
- One function, `private.is_assigned_to_project(project_id)`, based on
  `booking_assignments`, gates installer and subcontractor access on every
  app-facing table.
- Deleting a contact (UK GDPR) cascades to their projects and everything
  under them, except invoices, which are kept with personal fields cleared.
