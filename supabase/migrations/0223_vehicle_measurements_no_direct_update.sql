-- CONTRACT after audited edit form is deployed to every writer.
revoke update(odometer_km,fuel_level_percent,battery_level_percent,estimated_range_km) on public.vehicles from authenticated;
