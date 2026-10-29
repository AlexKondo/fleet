-- "Seu local de trabalho": the corporate mobility point where a person works. It is the default origin of their reservations and carpool
-- searches (the assistant and the reservation form only ask where they are going). Additive and nullable; deleting the point just clears it.
alter table public.profiles
  add column if not exists work_location_id uuid references public.corporate_mobility_points(id) on delete set null;

comment on column public.profiles.work_location_id is 'Corporate mobility point where the person works: default origin of trips (migration 0237).';
