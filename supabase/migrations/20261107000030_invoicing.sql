-- Invoices raised from the Invoices tab once a quote is accepted: stage
-- payments against the quote and extra work outside it, alongside the
-- deposit and balance. Each has a description for the customer and the
-- time it was last emailed.
alter table public.invoices drop constraint invoices_kind_check;
alter table public.invoices
  add constraint invoices_kind_check check (kind in ('deposit', 'stage', 'balance', 'extra')),
  add column description text check (description is null or length(description) <= 500),
  add column sent_at timestamptz;

-- The amount includes VAT, so VAT can't be more than it.
alter table public.invoices add constraint invoices_vat_check check (vat_pence >= 0 and vat_pence <= amount_pence);
