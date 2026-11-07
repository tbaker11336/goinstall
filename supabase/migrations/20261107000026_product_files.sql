-- A product's photo, shown with it on proposals (its datasheet PDF already
-- has products.datasheet_file_id).

alter table public.products
  add column photo_file_id uuid,
  add constraint products_photo_file_fk foreign key (company_id, photo_file_id)
    references public.files (company_id, id) on delete set null (photo_file_id);
