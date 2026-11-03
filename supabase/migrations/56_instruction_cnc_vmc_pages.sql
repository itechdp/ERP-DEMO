-- ============================================================
-- 56 · New pages: Workflow → Instruction, and Workflow → Machinery → CNC, VMC (QC also sits under Machinery in the sidebar)
-- ============================================================
-- Registers the pages for Access Control and gives every role a default: Plant Head write, the others read (the Director always has full access).
-- QC keeps its own page and permissions. Safe to run twice.

-- an earlier version of this file made one "CNC VMC" page and a separate "Machinery" group in Access Control: remove them
delete from role_page_access where resource = 'cnc_vmc';
delete from app_resources where key = 'cnc_vmc';
update app_resources set section = 'Workflow' where key = 'qc';

insert into app_resources (key, label, section, sort, writable) values
  ('instruction', 'Instruction', 'Workflow', 65, true),
  ('cnc', 'Machinery · CNC', 'Workflow', 77, true),
  ('vmc', 'Machinery · VMC', 'Workflow', 78, true)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;

insert into role_page_access (role, resource, level)
  select r, k, case when r = 'plant_head' then 'write' else 'read' end
    from unnest(array['plant_head', 'accounts', 'qc', 'operator', 'viewer']::app_role[]) r,
         unnest(array['instruction', 'cnc', 'vmc']) k
on conflict (role, resource) do nothing;
