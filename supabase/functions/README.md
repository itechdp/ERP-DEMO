# Edge Functions

The ERP does **not** send e-mail. The client mails purchase orders and quotations by hand; these functions only produce the PDF to attach
(the Excel version is made in the browser, so it needs no function).

| Function        | What it does |
| --------------- | ------------ |
| `po-pdf`        | Builds the PDF of a **Released** purchase order and returns a short-lived download link. |
| `quotation-pdf` | Builds the customer's PDF of an approved quotation (no cost, no margin) and returns a short-lived download link. |

Shared code is in `_shared/` (PDF builders, helpers, logo). `po-pdf` checks the caller first with the database function `can_send_po(poId)` **using the caller's own login**: only people with **Write** on *Purchase Orders* or *Purchase Approvals* can download, and only for a PO that is *Released* or *Sent to Supplier*. `quotation-pdf` does the same with `can_send_quotation(id)` (Write on *Sales Quotation* with access to customer names and prices; the quotation must be *Approved* or *Sent*).

## Before you deploy: database

Run the SQL migrations in order up to `33_invoice_payment_pdf.sql` and, for the quotation function, also `34_sales_module.sql`, `35_followups.sql` and `36_quotation_send.sql`. Migration 33 creates the `po-pdfs` storage bucket, the `company_settings` table and `can_send_po`; 36 creates the `quotation-pdfs` bucket and `can_send_quotation`.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to every function by Supabase automatically. There are no secrets to set.

## Deploy

From the project folder (the `supabase` CLI is run through `npx`, no global install needed):

```
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase functions deploy po-pdf
npx supabase functions deploy quotation-pdf
```

JWT verification stays **on** (the default): only signed-in users can call the functions.

### If the CLI is not available (dashboard editor)

The dashboard editor deploys one function at a time and does not see the shared `_shared/` folder next to it:

1. In the dashboard open **Edge Functions → Deploy a new function → Via Editor**, name it `po-pdf`.
2. Add one file for each file in `supabase/functions/_shared/` (same names: `format.ts`, `http.ts`, `logo.ts`, `po-data.ts`, `po-pdf.ts`, `deps.ts`) next to `index.ts`, and paste the contents.
3. In every file change `../_shared/` to `./` in the import lines (for example `'../_shared/http.ts'` → `'./http.ts'`).
4. Paste `po-pdf/index.ts` as `index.ts` and deploy. Repeat for `quotation-pdf` (it also needs `quotation-data.ts` and `quotation-pdf.ts`).

Using the CLI is much less error-prone; use the editor only if you must.

## Company details on the PDF

The header and the delivery box come from the table **`company_settings`** (one row, `id = 1`). To change them:

**Supabase → Table Editor → `company_settings` → edit the row** and fill in `name`, `address`, `gstin`, `phone`, `email`. A blank field is simply left out of the PDF. Users of the app cannot read or change this table; only the Edge Function (service role) and you in the dashboard can.

The logo is embedded in `_shared/logo.ts` (a small copy of `public/everest-logo-transparent.png`). To change it, replace the base64 string in that file and redeploy.

## Test

In the app open a **Released** PO as a Director or Plant Head → **Download PDF**, and **Download Excel** beside it. On an approved quotation use **Print / PDF** and **Excel** (Standard or Detailed).

Local run (needs Docker and the Supabase CLI):

```
npx supabase functions serve
curl -i http://127.0.0.1:54321/functions/v1/po-pdf -H "Authorization: Bearer <a user JWT>" -H "Content-Type: application/json" -d "{\"poId\": 1}"
```

* PDF font: the standard Helvetica built into every PDF viewer, so amounts are written **Rs.** (no ₹ sign). Characters outside Western European text are replaced by `?` instead of failing.
