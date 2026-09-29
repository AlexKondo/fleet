-- Checklist safety-equipment items used to be a fixed 3-item list hardcoded in the app
-- (SAFETY_EQUIPMENT_OPTIONS: triangulo/macaco/chave_de_roda) — no way for an org to add
-- more without a code change. Now an org-scoped, manager-editable list: fleet_manager/
-- administrator can add items from Settings, and record_pickup/record_return's
-- missing_safety_equipment stays a plain text[] (0001_init_schema.sql) with no FK to this
-- table, so it already tolerates whatever item names an org configures over time.

create table safety_equipment_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index safety_equipment_items_organization_id_idx on safety_equipment_items (organization_id);

alter table safety_equipment_items enable row level security;

create policy "members read own organization safety equipment items" on safety_equipment_items
  for select using (organization_id = current_organization_id());

create policy "fleet managers manage safety equipment items" on safety_equipment_items
  for insert with check (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where id = auth.uid() and role in ('fleet_manager', 'administrator')
    )
  );

create policy "fleet managers delete safety equipment items" on safety_equipment_items
  for delete using (
    organization_id = current_organization_id()
    and exists (
      select 1 from profiles
      where id = auth.uid() and role in ('fleet_manager', 'administrator')
    )
  );

insert into safety_equipment_items (organization_id, name)
select '00000000-0000-0000-0000-000000000001', item
from (values
  ('Triângulo de Segurança'),
  ('Step'),
  ('Macaco'),
  ('Chave de Roda'),
  ('Carregador Portátil'),
  ('Compressor de Ar'),
  ('Reparo de Pneu')
) as defaults(item);
