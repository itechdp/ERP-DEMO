-- 82 · CNC and VMC become process steps (step 1 of 2 — the enum values only).
-- PostgreSQL cannot use a new enum value in the transaction that adds it, so the logic is in 83. Run 82, then 83. Safe to run twice.
alter type process_stage add value if not exists 'cnc';
alter type process_stage add value if not exists 'vmc';
alter type job_stage     add value if not exists 'cnc';
alter type job_stage     add value if not exists 'vmc';
