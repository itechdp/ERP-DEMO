-- ============================================================
-- 71 · Main Menu → Workflow Overview
-- ============================================================
-- Registers the page for Access Control. Default: the Director and the Plant Head see it (they always have full access);
-- Accounts, QC, Operator and Viewer start with it hidden — the Director can open it for anybody in Access Control. Read-only page.
-- Safe to run twice.

insert into app_resources (key, label, section, sort, writable) values ('workflow_overview', 'Workflow Overview', 'Main Menu', 13, false)
on conflict (key) do update set label = excluded.label, section = excluded.section, sort = excluded.sort, writable = excluded.writable;

insert into role_page_access (role, resource, level)
  select r, 'workflow_overview', 'hidden'
    from unnest(array['accounts', 'qc', 'operator', 'viewer']::app_role[]) r
on conflict (role, resource) do nothing;
