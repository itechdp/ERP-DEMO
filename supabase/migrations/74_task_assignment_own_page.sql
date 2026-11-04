-- ============================================================
-- 74 · Task Assignment is its own page again (under the Work Hub in the menu)
-- ============================================================
-- It was a tab of the Work Hub (migration 58). The tab no longer exists, so its line in Access Control goes away.
-- Who may open Task Assignment is the page "Task Assignment" itself, as before. Safe to run twice.

delete from role_page_access where resource = 'work_hub__assignment';
delete from app_resources where key = 'work_hub__assignment';
