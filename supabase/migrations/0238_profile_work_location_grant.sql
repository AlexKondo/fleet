-- profiles is readable by column (0063): the new work_location_id (0237) needs its own SELECT grant, otherwise every read that names it fails
-- (the Equipe page showed "could not load the team"). It is not sensitive: the same people can already read the profile's name and role.
grant select (work_location_id) on public.profiles to authenticated;
