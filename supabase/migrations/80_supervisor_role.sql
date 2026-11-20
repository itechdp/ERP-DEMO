-- 80 · New role: Supervisor (step 1 of 2 — the enum value only).
-- PostgreSQL cannot use a new enum value in the same transaction that adds it, so the rules for the role are in 81.
-- Run 80, then 81. Safe to run twice.
alter type app_role add value if not exists 'supervisor';
