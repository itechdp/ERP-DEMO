-- ============================================================
-- 88 · Job card numbers: EAF-2026-0005 (dash instead of slash)
-- ============================================================
-- Needs 87. New job cards are numbered EAF-<year>-<running number>, e.g. EAF-2026-0005. The running number continues from the job
-- cards already made this year and starts again at 0001 every 1st January. Existing job card numbers are not changed. Safe to run twice.

update doc_no_kinds set prefix = 'EAF', fmt = 'EAF-{Y}-{N}' where key = 'job';
