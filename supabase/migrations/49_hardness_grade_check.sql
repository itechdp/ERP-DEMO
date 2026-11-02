-- "Grade … does not belong to Brass" on a hardness report. Cause found: the material list in the database had NO Brass rows
-- (select … from material_master where family ilike 'bras%' returned nothing), so no Brass grade can ever match.
-- 0) put back the standard Aluminium / Brass / Copper materials if they are missing (never changes a row that exists),
-- The database check also demanded a row in hardness_specs for the grade's material; a material added or renamed since the first
-- set-up may have none. 1) put back the standard ranges for the seven standard materials (never overwrites an existing row),
-- 2) make the check ask only what it should: does this grade exist in the material list under this family?
insert into material_master (material, family, grade, density, default_od) values
  ('Brass Round Bar',         'Brass',     'CW614N / CuZn39Pb3 (free-cutting brass)',  8.47, 45),
  ('Forging Brass Round Bar', 'Brass',     'CW617N / CuZn40Pb2 (hot-stamping brass)',  8.43, 45),
  ('Copper Round Bar',        'Copper',    'ETP Copper C11000 / Cu-ETP',               8.94, 30),
  ('OFHC Copper Round Bar',   'Copper',    'Oxygen-free Copper C10200 / Cu-OF',        8.94, 30),
  ('Aluminium Round Bar',     'Aluminium', 'AA 6061-T6',                               2.70, 25),
  ('Aluminium 6082 Round Bar','Aluminium', 'AA 6082-T6',                               2.71, 25),
  ('Aluminium 2014 Round Bar','Aluminium', 'AA 2014 (forging alloy)',                  2.80, 25)
on conflict (material) do nothing;

insert into hardness_specs (material, min_hardness, max_hardness, scale)
select v.material, v.mn, v.mx, 'HRB'
  from (values ('Aluminium Round Bar', 55, 65), ('Aluminium 6082 Round Bar', 80, 90), ('Aluminium 2014 Round Bar', 70, 80),
               ('Brass Round Bar', 60, 80), ('Forging Brass Round Bar', 55, 75), ('Copper Round Bar', 35, 55), ('OFHC Copper Round Bar', 30, 50)) as v (material, mn, mx)
 where exists (select 1 from material_master m where m.material = v.material)
on conflict (material) do nothing;

do $$
begin
  perform _patch_fn('save_hardness_report',
    $f$select 1 from material_master m join hardness_specs h using (material)$f$,
    $f$select 1 from material_master m$f$);
end $$;
