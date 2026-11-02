-- 40 · Raw Material Inventory moves from the Workflow section to the Main Menu (its own page, no longer inside the Work Hub).
-- Only the grouping changes — nobody's access to the page does. Safe to run twice.
update app_resources set section = 'Main Menu', sort = 13 where key = 'raw_inventory';
