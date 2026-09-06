alter table vehicle_categories add column energy_type energy_type;

-- Backfill from whichever energy type most of that category's existing vehicles already
-- use. Checked directly against production data before writing this: every real
-- organization's categories were already energy-homogeneous (one type per category) --
-- only test/simulation data had a handful of categories mixing types, an artifact of
-- vehicles being added with random energy types rather than a real fleet decision.
update vehicle_categories vc
set energy_type = sub.energy_type
from (
  select distinct on (category_id) category_id, energy_type
  from vehicles
  group by category_id, energy_type
  order by category_id, count(*) desc
) sub
where vc.id = sub.category_id;

-- Categories with no vehicles yet have nothing to infer from -- ICE is the least
-- surprising default (a fleet manager editing a brand-new category will typically set
-- this before adding its first vehicle anyway).
update vehicle_categories set energy_type = 'ICE' where energy_type is null;

alter table vehicle_categories alter column energy_type set not null;

alter table vehicles drop column energy_type;
