-- 43 · The RFQ page is now called "Procurement of Material" (Settings → Access Control shows the new name). Safe to run twice.
update app_resources set label = 'Procurement of Material' where key = 'rfq';
