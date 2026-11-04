# ForgeFlow ERP: Forging & Casting Client Demo

A web ERP for the full production flow, backed by **Supabase** (Postgres + Auth + Storage):

**Raw Inventory → Cutting → Forging → Trimming → Heat Treatment → QC → Finished Goods → Dispatch*

It tracks quantities stage by stage, records loss and rejection, and keeps one job number from raw material through to dispatch.
Every business rule runs inside the database (`supabase/migrations`), and who may see party names, rates and invoices is enforced there too (Director, Plant Head and Accounts see them; everyone else gets them withheld).

## Connect to Supabase (once)

1. Create the project, then run the files in `supabase/migrations/` in order (`01_…` → `19_…`) in the SQL editor.
2. Run `supabase/seed.sql` (masters), then — for a demo — `supabase/seed_demo.sql` (demo data + the six demo logins).
3. Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Project Settings → API). Only the anon key — never the `service_role` key.
4. `npm run dev` and sign in. Roles come from the `profiles` table; new users start as `viewer` until a Director sets their role.

See `supabase/PLAN.md` for the design and `supabase/DEMO_GUIDE.md` for the demo walkthrough.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build in dist/
npm run test:engine  # headless checks of the quantity engine (runs the worked example below)
```

## Starting data

The database starts with the **masters only** (`supabase/seed.sql`: material grades, hardness ranges, customers, suppliers, machines, operators, inspectors). There are no products, stock or jobs — the Director or Plant Head adds products in Product Master, and everything else is entered through the app. `supabase/seed_demo.sql` loads an optional demo dataset.

## Raw material master

The inward form uses dropdowns, so nobody has to type material names:

- **Material** is grouped by family: Carbon Steel (EN8, EN9, EN3), Alloy Steel (EN19, EN24, 20MnCr5), Stainless Steel (SS304, SS316, SS410), Brass (CW614N, CW617N forging brass), Copper (ETP, OFHC) and Aluminium (6061, 6082, 2014).
- **Grade / Specification** fills in automatically from the material.
- **OD / Size** is chosen from standard bar diameters (12–120 mm).
- **Supplier** is chosen from the supplier list.
- **Total Weight** is calculated automatically from quantity × piece length × π/4·OD² × density. For example, a Ø50 steel bar works out at 15.41 kg per metre. You can overwrite it with the actual weighed weight.

At each process stage, **Loss Reason** is chosen from standard forging defects (for example under-fill, lap / fold or quench crack). The Heat Treatment **Process** is also a dropdown.
The master list is in `src/store/materials.ts`.

## Screens follow the paper Process Route Card

Every form uses only the fields the client already fills on the paper route card:

- **New Job Card:** Job Card No. (auto), Date, Item, Material / Bar OD, Length, Weight per piece (auto from OD × length × density), Qty to Cut, Die No., Machine No.
- **Cutting, Forging, Trimming, Heat Treatment, QC:** one row each, with Inward Date, Received Qty, Rejection Qty, OK Qty (auto = Received − Rejection) and Checked By. Heat Treatment also has its Temperature. Trimming has a **"Not required"** tick for jobs that skip it.
- **Dispatch:** Job Card No., Date, Vehicle No., and one row per bag (qty + weighed weight; a blank weight is calculated).

## Checking the flow and calculations (worked example)

1. **Raw Inventory → Add Raw Material Inward**: EN8 Steel Round Bar, OD 50, choose a supplier, **600 PCS / 168 KG**. Add a second inward of **400 PCS**. EN8 stock is now **1,000**.
2. **Cutting → New Job Card**: 9084 Flange, EN8 Ø50, Length 62 mm (weight per piece fills in at 956 g), Qty to Cut **700**. Stock stays at 1,000.
3. **Cutting → Enter Qty**: Received 700, Rejection **14** → OK **686**. FIFO issues 600 PCS from the first lot and 100 from the second, so stock drops to **300**.
4. **Forging**: Received 686 (locked), Rejection 6 → **680**.
5. **Trimming**: 680 − 5 → **675** (or tick "Not required" to pass all pieces on).
6. **Heat Treatment** (850°C from the product): 675 − 3 → **672**.
7. **QC**: 672 − 4 → **668** OK, which goes to Finished Goods.
8. **Dispatch**: vehicle number and bags (e.g. 300 + 368). Finished Goods becomes **0**.
9. Click the job number. The reconciliation line reads **700 issued = 28 process loss + 4 QC rejected + 668 finished goods** (balanced).

## Making it easy to follow

- **Next Action buttons:** every active job on the Dashboard has one ("Complete Forging", "Inspect at QC", "Dispatch Goods"), which opens the right form straight away.
- **Next step in the job drawer:** you can push one job from stage to stage without leaving its timeline, and watch the timeline fill in.
- **Bell (top bar):** lists every job waiting for someone to act.
- **Workflow bar:** every flow page shows all 8 stages with their live load, and you can click any stage to go there.
- **Dark mode and a collapsible sidebar:** both are remembered in this browser.

## Code map

| Path | Purpose |
|---|---|
| `src/store/engine.ts` | All quantity rules (pure functions). Output = Input − Loss; the next stage's input = the previous stage's output; FIFO raw issue; QC balance; FG reserve and dispatch |
| `src/store/seed.ts` | Empty starting state used by `scripts/engine-test.ts` only |
| `src/db/client.ts` | Supabase client (URL + anon key from `.env`) |
| `src/db/load.ts` | Reads every screen's data from the database views and maps it to the app's types |
| `src/db/api.ts` | One call per business action (inward, job card, stages, QC, dispatch, hardness, product, dies) → a database function |
| `src/auth/*` | Supabase sign-in, role flags (`v_me`), `<Conf>` that hides confidential columns, login page |
| `src/store/StoreContext.tsx` | Loaded data, `run()` for actions, toasts and the trace drawer |
| `src/pages/*` | Dashboard, Raw Inventory, one page shared by the four process stages, QC, Finished Goods, Dispatch, Traceability, Ledger, Product Master |
| `src/components/TraceDrawer.tsx` | Job traceability timeline, with a Next step button |
| `src/components/workflow.ts`, `ActionHost.tsx` | Work out each job's next step and open its form from any screen |
