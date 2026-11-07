-- What the company pays for a product (ex VAT), entered on the product
-- form. Used to show the profit on a job; supplier offers' prices are used
-- when it isn't set.
alter table public.products
  add column cost_price_pence bigint check (cost_price_pence is null or cost_price_pence >= 0);
