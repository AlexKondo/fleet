-- Realistic local fixtures (King-Kondo §27): multiple categories, ICE + BEV mix, varied
-- battery/fuel levels, vehicles spread across most operational statuses, an existing
-- reservation that matches the carpooling example in fleet-car-saas.txt §4, and a
-- Trip-Specific Readiness edge case (ORA 05 with 10% battery / 20km range, §7).

insert into organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'GWM — Planta Iracemápolis');

insert into organization_settings (organization_id) values
  ('00000000-0000-0000-0000-000000000001');

-- Demo users (password "password123" for all — local dev only, never used in production).
-- The token columns must be '' rather than NULL: GoTrue's Go SQL scanner errors on NULL
-- for these varchar columns even though Postgres itself allows it (local-dev gotcha).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'gestor@gwm-demo.local', crypt('password123', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'colaborador@gwm-demo.local', crypt('password123', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'portaria@gwm-demo.local', crypt('password123', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}', '{}', '', '', '', '', '', '', '', '');

insert into profiles (id, organization_id, full_name, role) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Marina Fleet Manager', 'fleet_manager'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Carlos Colaborador', 'employee'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Equipe Portaria P1', 'security');

insert into vehicle_locations (id, organization_id, name) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Portaria P1'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Assembly Shop — área externa'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Restaurante — carregadores'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Administração');

insert into vehicle_categories (id, organization_id, name, passenger_capacity, supports_cargo) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Sedan', 5, false),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'SUV (Haval H6)', 5, false),
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Compact EV (ORA 03)', 4, false),
  ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Compact EV (ORA 05)', 4, false),
  ('30000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Pickup de Carga (Poer P30)', 3, true);

insert into vehicles (
  id, organization_id, plate, category_id, energy_type, status, odometer_km,
  fuel_level_percent, battery_level_percent, estimated_range_km, next_service_odometer_km,
  home_location_id, current_location_id, has_blocking_damage, missing_safety_equipment,
  documentation_valid, is_clean_exterior, is_clean_interior
) values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'GWM1A23', '30000000-0000-0000-0000-000000000001', 'ICE', 'available', 18900, 90, null, 520, 20000, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', false, '{}', true, true, true),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'GWM2B45', '30000000-0000-0000-0000-000000000002', 'ICE', 'reserved', 41200, 75, null, 480, 45000, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', false, '{}', true, true, true),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'GWM3C67', '30000000-0000-0000-0000-000000000003', 'BEV', 'charging', 12500, null, 42, 100, 40000, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', false, '{}', true, true, true),
  ('40000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'GWM4D89', '30000000-0000-0000-0000-000000000004', 'BEV', 'available', 9800, null, 10, 20, 40000, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', false, '{}', true, true, true),
  ('40000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'GWM5E12', '30000000-0000-0000-0000-000000000005', 'ICE', 'available', 33400, 60, null, 400, 35000, '20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', false, '{}', true, true, true),
  ('40000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', 'GWM6F34', '30000000-0000-0000-0000-000000000001', 'ICE', 'maintenance', 59800, 30, null, 150, 60000, '20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', false, '{}', true, false, true),
  ('40000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', 'GWM7G56', '30000000-0000-0000-0000-000000000002', 'ICE', 'in_use', 27600, 55, null, 350, 40000, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', false, '{}', true, true, true),
  ('40000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', 'GWM8H78', '30000000-0000-0000-0000-000000000001', 'ICE', 'blocked', 15200, 80, null, 460, 25000, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', true, '{"triangulo"}', true, true, false),
  ('40000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', 'GWM9J90', '30000000-0000-0000-0000-000000000003', 'BEV', 'available', 6200, null, 88, 175, 40000, '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', false, '{}', true, true, true),
  ('40000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'GWM0K12', '30000000-0000-0000-0000-000000000001', 'ICE', 'awaiting_pickup', 22100, 95, null, 540, 30000, '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', false, '{}', true, true, true);

-- Haval H6 (GWM2B45) already committed to a São Paulo trip — the exact carpooling
-- scenario described in fleet-car-saas.txt §4.
insert into trip_requests (id, organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, requires_cargo, justification) values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', now() + interval '1 day' + interval '7 hours 45 minutes', now() + interval '1 day' + interval '17 hours 30 minutes', 'Iracemápolis', 'São Paulo', 260, 2, false, 'Reunião com fornecedor');

insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values
  ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'confirmed', now() + interval '1 day' + interval '7 hours 45 minutes', now() + interval '1 day' + interval '17 hours 30 minutes');

-- Sedan (GWM0K12) already awaiting pickup for a short trip starting soon.
insert into trip_requests (id, organization_id, requester_id, departure_at, expected_return_at, origin, destination, distance_km, passenger_count, requires_cargo, justification) values
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', now() + interval '2 hours', now() + interval '6 hours', 'Iracemápolis', 'Limeira', 45, 1, false, 'Visita técnica');

insert into reservations (organization_id, vehicle_id, trip_request_id, status, start_at, end_at) values
  ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000010', '50000000-0000-0000-0000-000000000002', 'confirmed', now() + interval '2 hours', now() + interval '6 hours');
