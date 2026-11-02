-- ONE SAMPLE DISPATCH, to look at the Packing List (print / PDF / Excel). Run once in the Supabase SQL editor.
-- It goes through the real functions (stock in -> job -> every stage -> QC -> finished goods -> dispatch), so the numbers obey the rules.
-- Adds: 1 raw-material lot (200 pcs), 1 product "Sample Brass Bush", 1 job, 1 dispatch of 60 pcs in 3 bags (DSP-xxxx).
-- It does not touch or delete anything that already exists. Customer / supplier names in it are fictional.

-- the Brass material must exist (a missing master is why this is here; an existing row is left alone)
insert into material_master (material, family, grade, density, default_od)
values ('Brass Round Bar', 'Brass', 'CW614N / CuZn39Pb3 (free-cutting brass)', 8.47, 45)
on conflict (material) do nothing;

-- the supplier (suppliers need a code, so it is added here with the next free one)
insert into suppliers (code, name)
select 'SUP-' || lpad(((select coalesce(max(id), 0) from suppliers) + 1)::text, 4, '0'), 'Sample Metals'
 where not exists (select 1 from suppliers where name = 'Sample Metals');

select save_product('{"id":"P-SAMPLE","code":"SMP-45","name":"Sample Brass Bush","material":"Brass Round Bar","od":45,"cutting_length":38,"finished_weight":0.105,
  "ht_temperature":550,"ht_soak_minutes":45,"ht_process":"Stress-relief annealing","ht_quench":"Still air","die_no":"D-SMP-01",
  "default_customer":"Sample Customer Pvt. Ltd.","sales_rate":62}'::jsonb);

do $$
declare
  v_job text;
  v_fg  text;
  v_dsp text;
begin
  perform add_inward('Brass Round Bar', 'CW614N / CuZn39Pb3', 45, 'Sample Metals', current_date, 200, 100, 'H-SAMPLE', 'SAMPLE/001', 590);
  v_job := create_job('P-SAMPLE', 100, 'Brass Round Bar', 45, 38, 'Sample Customer Pvt. Ltd.', current_date + 7, 'Normal', 100, 'D-SMP-01', 'FP-400T');
  perform complete_stage('cutting',       v_job, 2, p_input_qty => 100);
  perform complete_stage('forging',       v_job, 1);
  perform complete_stage('trimming',      v_job, 0, p_remarks => 'Not required — skipped', p_params => '{"skipped":1}'::jsonb);
  perform complete_stage('heatTreatment', v_job, 1, p_params => '{"temperature":550}'::jsonb);
  v_fg := complete_qc(v_job, 94, 2, 'Sample Inspector', 'Burr on 2 pcs');
  v_dsp := create_dispatch(v_fg, 'MH12 AB 1234', current_date, 'Dispatched',
    p_bags => '[{"qty":20,"weight":2.1},{"qty":20,"weight":2.1},{"qty":20,"weight":2.1}]'::jsonb,
    p_driver => 'Sample Driver', p_invoice_no => 'SAMPLE/26/001');
  raise notice 'Created job %, finished goods %, dispatch %', v_job, v_fg, v_dsp;
end $$;
