-- What the customer sees of each proposal line. Every line still counts in
-- the totals; 'hide_price' shows the line without its price, 'hide' leaves
-- it off the proposal entirely.
alter table public.proposal_lines
  add column display text not null default 'show'
    check (display in ('show', 'hide_price', 'hide'));
