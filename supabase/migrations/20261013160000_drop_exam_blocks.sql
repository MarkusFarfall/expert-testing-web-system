-- Откат названий тематических блоков (уточнение заказчика): у блоков только номер.
drop table if exists public.exam_blocks;
alter table public.bank_backups drop column if exists blocks;
