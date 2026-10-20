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
| 2 | `surveys` | One per project; online and in-person status, surveyor, hashed link token |
| 2 | `survey_questions` | Per-company configurable questions by product |
| 2 | `survey_fields` | Current value per key, with source and editor |
| 2 | `survey_field_history` | Every overwritten value (offline conflicts: last write wins, history kept) |
| 2 | `photo_categories` | Per-company required photo types |
| 2 | `files` | All stored objects (photos, signatures, PDFs, attachments): bucket path, type, uploader; other tables reference it |
| 3 | `products` | Company catalogue: category, make, model, specs JSON, sell price |
| 3 | `suppliers` | Connection type, credentials reference, last sync |
| 3 | `supplier_products` | Cost, stock, lead time and SKU per supplier per product (replaces `products.supplier_id` in the spec, so the Kit tab can compare suppliers) |
| 3 | `roof_data_cache` | Google Solar API responses per project, so each billed call is made once |
| 3 | `solar_designs`, `ev_designs` | Append-only versions; one active per project (partial unique index); geometry as JSON |
| 3 | `calc_tables` | Versioned MCS lookup and EV rule tables supplied by the business |
| 4 | `proposals` | Versioned; locked once sent (edits create a new version); status, totals, deposit, signature, hashed public token |
| 4 | `proposal_lines` | One row per line (replaces line-item JSON in the spec), for price-edit audit and kit generation |
| 4 | `proposal_views` | Each customer view |
| 4 | `invoices` | Deposit and balance invoices with Xero reference (not in the spec) |
| 4 | `payments` | Stripe payments against an invoice |
| 5 | `purchase_orders`, `purchase_order_lines` | One order per supplier |
| 5 | `bookings` | Survey, install, scaffold up/down |
| 5 | `booking_assignments` | Team, electrician and scaffolder per booking; drives installer and subcontractor access |
| 5 | `checklist_templates`, `checklist_items` | Per-company steps; completed items carry photo, readings and serials |
| 6 | `paperwork` | Type, status, due date, reference, generated file |

## Access rules

- Prices live only in tables subcontractors cannot select
  (`proposal_lines`, `supplier_products`, `invoices`, `payments`,
  `purchase_order_lines`, product prices), rather than hiding columns.
- One function, `private.is_assigned_to_project(project_id)`, based on
  `booking_assignments`, gates installer and subcontractor access on every
  app-facing table.
- Deleting a contact (UK GDPR) cascades to their projects and everything
  under them, except invoices, which are kept with personal fields cleared.
