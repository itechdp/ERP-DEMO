// The 14-row quotation costing table: calculations, kg / gram, removing and restoring rows, checks, saving and reading back.
// Run: npm run test:costing
import { quotationHtml } from '../src/salesmod/print';
import type { QuotationLine, QuotationRow } from '../src/salesmod/types';
import { costBeforeProfit, computeCosting, r2, costingErrors, costingMissing, costingProblem, emptyCosting, finalCostOf, isCosted, parseCosting, printableRows, serializeCosting, type CostingState } from '../src/salesmod/costing';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};
const amt = (s: CostingState, key: string) => computeCosting(s).rows.find((r) => r.key === key)!.amount;

// the example from the client's sheet
const base: CostingState = { weight: 0.9, unit: 'kg', matRate: 425, forging: 225, forgingMode: 'amt', rejPct: 2, machining: 55, scrap: 135, scrapMode: 'amt', scrapRate: null, scrapG: null, packing: 3, profitPct: 5, removed: [] };

// ---- 1. every one of the 14 rows
const c = computeCosting(base);
check('there are exactly 14 rows, numbered 1 to 14', c.rows.length === 14 && c.rows.every((r, i) => r.no === i + 1));
check('2 Material = 0.900 kg × 425 = 382.50', amt(base, 'material') === 382.5, amt(base, 'material'));
check('3 Forging Labour = 225', amt(base, 'forging') === 225);
check('4 RM with Forging Cost = 607.50', amt(base, 'rm') === 607.5, amt(base, 'rm'));
check('5 Rejection @ 2% = 12.15', amt(base, 'rejection') === 12.15, amt(base, 'rejection'));
check('6 Cost with Rejection = 619.65', amt(base, 'withRej') === 619.65, amt(base, 'withRej'));
check('7 Machining = 55', amt(base, 'machining') === 55);
check('8 Cost with Machining = 674.65', amt(base, 'withMach') === 674.65, amt(base, 'withMach'));
check('9 Scrap Recovery = −135 (a deduction)', amt(base, 'scrap') === -135);
check('10 Net Cost = 539.65', amt(base, 'net') === 539.65, amt(base, 'net'));
check('11 Packing = 3', amt(base, 'packing') === 3);
check('12 Cost Before Profit = 542.65', amt(base, 'before') === 542.65, amt(base, 'before'));
check('13 Profit @ 5% = 27.13', amt(base, 'profit') === 27.13, amt(base, 'profit'));
check('14 Final Cost = 569.78 (the client\'s expected result)', c.final === 569.78 && amt(base, 'final') === 569.78, c.final);
check('labels follow the percentages', c.rows[4].label === 'Rejection @ 2%' && c.rows[12].label === 'Profit @ 5%', [c.rows[4].label, c.rows[12].label]);
check('subtotals and Final Cost are marked strong', c.rows.filter((r) => r.strong).map((r) => r.key).join() === 'rm,withRej,withMach,net,before,final');


// ---- 1b. the company's own costing sheet, row by row (weight 0.9 kg, material 425, forging 250 per kg, scrap 450 × 300 g)
const sheet: CostingState = { weight: 0.9, unit: 'kg', matRate: 425, forging: 250, forgingMode: 'kg', rejPct: 2, machining: 55, scrap: null, scrapMode: 'weight', scrapRate: 450, scrapG: 300, packing: 3, profitPct: 5, removed: [] };
const sh = computeCosting(sheet).rows;
const line = (i: number) => [sh[i].label, sh[i].basis, sh[i].amount];
const want: [string, string, number | null][] = [
  ['Input Weight', '0.900 kg', null],
  ['Material', '425 × 0.900 kg', 382.5],
  ['Forging Labour', '250 × 0.900 kg', 225],
  ['RM with Forging Cost', '382.50 + 225.00', 607.5],
  ['Rejection @ 2%', '607.50 × 2%', 12.15],
  ['Cost with Rejection', '607.50 + 12.15', 619.65],
  ['Machining', '—', 55],
  ['Cost with Machining', '619.65 + 55.00', 674.65],
  ['Scrap Recovery 450 X 300', 'Less: Scrap Value', -135],
  ['Net Cost', '674.65 − 135.00', 539.65],
  ['Packing & Forwarding', '—', 3],
  ['Cost Before Profit', '539.65 + 3.00', 542.65],
  ['Profit @ 5%', '542.65 × 5%', 27.13],
];
want.forEach((w, i) => check(`sheet row ${i + 1}: ${w[0]} | ${w[1]} | ${w[2] ?? '-'}`, JSON.stringify(line(i)) === JSON.stringify(w), line(i)));
check('sheet row 14: Final Cost 569.78', sh[13].label === 'Final Cost' && sh[13].amount === 569.78, line(13));
check('amount mode (225 and 135 typed directly) gives the same Final Cost as the sheet', computeCosting(base).final === computeCosting(sheet).final);
check('Forging per kg follows the weight: 1.8 kg → 450', computeCosting({ ...sheet, weight: 1.8 }).rows[2].amount === 450);
check('Forging per kg uses grams correctly: 900 g → 225', computeCosting({ ...sheet, weight: 900, unit: 'g' }).rows[2].amount === 225);
check('Scrap by weight: 450 per kg × 300 g = 135, × 500 g = 225', computeCosting(sheet).rows[8].amount === -135 && computeCosting({ ...sheet, scrapG: 500 }).rows[8].amount === -225);
check('negative scrap rate or grams is refused', !!costingErrors({ ...sheet, scrapRate: -1 }).scrap && !!costingErrors({ ...sheet, scrapG: -5 }).scrap);
check('scrap worth more than the cost is refused (by weight too)', !!costingErrors({ ...sheet, scrapG: 5000 }).scrap);
check('a removed Scrap row drops its numbers from the label', computeCosting({ ...sheet, removed: ['scrap'] }).rows[8].label === 'Scrap Recovery');
const sheetBack = parseCosting(JSON.parse(JSON.stringify(serializeCosting(sheet))))!;
check('the sheet inputs come back exactly after saving (modes, rate, grams)', sheetBack.forgingMode === 'kg' && sheetBack.forging === 250 && sheetBack.scrapMode === 'weight' && sheetBack.scrapRate === 450 && sheetBack.scrapG === 300 && computeCosting(sheetBack).final === 569.78, sheetBack);
const amtBack = parseCosting(JSON.parse(JSON.stringify(serializeCosting(base))))!;
check('amount-mode inputs come back as amounts', amtBack.forgingMode === 'amt' && amtBack.forging === 225 && amtBack.scrapMode === 'amt' && amtBack.scrap === 135 && computeCosting(amtBack).final === 569.78);
// a table saved by the first version of this feature had no modes: forging and scrap were plain amounts held in `input`
const firstVersion = JSON.parse(JSON.stringify(serializeCosting(base))).map((r: any) => {
  const { mode, input2, input3, ...rest } = r;
  return r.key === 'scrap' ? { ...rest, input: 135 } : rest;
});
const fv = parseCosting(firstVersion)!;
check('a table saved before the modes existed still opens as amounts with the same Final Cost', fv.forgingMode === 'amt' && fv.scrapMode === 'amt' && fv.scrap === 135 && computeCosting(fv).final === 569.78, [fv.forgingMode, fv.scrapMode, fv.scrap]);
// switching the basis must not lose what was typed for the other basis
const both: CostingState = { ...sheet, scrap: 135, scrapMode: 'amt' };
const bothBack = parseCosting(JSON.parse(JSON.stringify(serializeCosting(both))))!;
check('both ways of entering scrap survive saving: amount 135 AND rate 450 × 300 g', bothBack.scrapMode === 'amt' && bothBack.scrap === 135 && bothBack.scrapRate === 450 && bothBack.scrapG === 300, bothBack);
check('switching to rate × weight and back keeps both', computeCosting({ ...bothBack, scrapMode: 'weight' }).rows[8].amount === -135 && computeCosting(bothBack).rows[8].amount === -135);
// rounding: half a paisa rounds up, and binary noise does not round it down
check('rounding: 30.575 → 30.58, 1.005 → 1.01, 2.675 → 2.68, −135.005 → −135.01', r2(30.575) === 30.58 && r2(1.005) === 1.01 && r2(2.675) === 2.68 && r2(-135.005) === -135.01, [r2(30.575), r2(1.005), r2(2.675), r2(-135.005)]);
// by hand at 1 kg with the sheet inputs: 425 + 250 = 675; +2 % = 688.50; +55 = 743.50; −135 = 608.50; +3 = 611.50; +5 % = 30.575 → 30.58; 642.08
check('sheet inputs at 1 kg → Final Cost 642.08 (worked out by hand)', computeCosting({ ...sheet, weight: 1 }).final === 642.08, computeCosting({ ...sheet, weight: 1 }).final);

// ---- 2. kg and grams
const grams = { ...base, weight: 900, unit: 'g' as const };
check('900 g gives the same Final Cost as 0.9 kg', computeCosting(grams).final === 569.78, computeCosting(grams).final);
check('grams show their kg equivalent', computeCosting(grams).rows[0].basis === '900 g = 0.900 kg', computeCosting(grams).rows[0].basis);
check('1250 g = 1.25 kg of material', amt({ ...base, weight: 1250, unit: 'g' }, 'material') === 531.25, amt({ ...base, weight: 1250, unit: 'g' }, 'material'));

// ---- 3. changing an input updates everything below it
check('a heavier piece costs more', computeCosting({ ...base, weight: 1.2 }).final > 569.78);
// by hand at 1 kg: 425 + 225 = 650; +2% = 663; +55 = 718; −135 = 583; +3 = 586; +5% (29.30) = 615.30
check('Input Weight 1.0 kg → Final Cost 615.30 (worked out by hand)', computeCosting({ ...base, weight: 1 }).final === 615.3, computeCosting({ ...base, weight: 1 }).final);
check('changing the material rate changes Material and the Final Cost', amt({ ...base, matRate: 500 }, 'material') === 450 && computeCosting({ ...base, matRate: 500 }).final > 569.78);
check('rejection 0% leaves the cost as it was', amt({ ...base, rejPct: 0 }, 'withRej') === 607.5);
check('profit 10% = double the 5% profit line (approximately)', amt({ ...base, profitPct: 10 }, 'profit') === 54.27, amt({ ...base, profitPct: 10 }, 'profit'));

// ---- 4. removing optional rows
const noScrapPack = { ...base, removed: ['scrap', 'packing'] as CostingState['removed'] };
const r = computeCosting(noScrapPack);
check('removing Scrap Recovery: Net Cost = Cost with Machining (674.65)', amt(noScrapPack, 'net') === 674.65, amt(noScrapPack, 'net'));
check('removing Packing: Cost Before Profit = Net Cost', amt(noScrapPack, 'before') === 674.65);
check('profit is worked out on the new Cost Before Profit (33.73)', amt(noScrapPack, 'profit') === 33.73, amt(noScrapPack, 'profit'));
check('Final Cost after removing both = 708.38', r.final === 708.38, r.final);
check('the removed rows are marked removed, the others are not', r.rows.filter((x) => x.removed).map((x) => x.key).join() === 'scrap,packing');
check('the calculation text leaves a removed row out', r.rows.find((x) => x.key === 'net')!.basis === '674.65' && r.rows.find((x) => x.key === 'before')!.basis === '674.65', [r.rows.find((x) => x.key === 'net')!.basis, r.rows.find((x) => x.key === 'before')!.basis]);
check('removing Forging, Rejection, Machining and Profit too leaves just the material', computeCosting({ ...base, removed: ['forging', 'rejection', 'machining', 'scrap', 'packing', 'profit'] }).final === 382.5);
check('a removed row\'s typed value is kept (so Restore brings it back)', noScrapPack.scrap === 135 && noScrapPack.packing === 3);
const restored = { ...noScrapPack, removed: [] as CostingState['removed'] };
check('restoring the rows brings back the original Final Cost 569.78', computeCosting(restored).final === 569.78, computeCosting(restored).final);
// Scrap removed only: 674.65 + 3 = 677.65; 5% = 33.8825 → 33.88; 677.65 + 33.88 = 711.53
check('removing only Scrap Recovery → Final Cost 711.53 (worked out by hand)', computeCosting({ ...base, removed: ['scrap'] }).final === 711.53, computeCosting({ ...base, removed: ['scrap'] }).final);
check('only optional rows can be removed (Material / subtotals / Final ignored)', computeCosting({ ...base, removed: ['material', 'rm', 'final', 'weight'] as CostingState['removed'] }).final === 569.78);

// ---- 5. checking input
check('a negative weight is refused', !!costingErrors({ ...base, weight: -1 }).weight);
check('a negative rate / amount is refused', !!costingErrors({ ...base, matRate: -5 }).material && !!costingErrors({ ...base, machining: -1 }).machining && !!costingErrors({ ...base, packing: -1 }).packing);
check('a percentage over 100 is refused', !!costingErrors({ ...base, rejPct: 101 }).rejection && !!costingErrors({ ...base, profitPct: 150 }).profit);
check('scrap worth more than the cost is refused', !!costingErrors({ ...base, scrap: 5000 }).scrap);
check('the example has no errors', Object.keys(costingErrors(base)).length === 0 && Object.keys(costingMissing(base)).length === 0);
check('an empty table asks for the weight and material rate', !!costingMissing(emptyCosting()).weight && !!costingMissing(emptyCosting()).material);
check('a negative value counts as 0 in the maths (never reduces a cost)', computeCosting({ ...base, machining: -50 }).final === computeCosting({ ...base, machining: 0 }).final);
check('a removed row is not checked', Object.keys(costingErrors({ ...base, packing: -1, removed: ['packing'] })).length === 0);
check('the first problem is described in words', costingProblem({ ...base, weight: null }).startsWith('1. Input Weight'), costingProblem({ ...base, weight: null }));
check('Cost Before Profit (the saved cost) is row 12: 542.65', costBeforeProfit(base) === 542.65 && costBeforeProfit(noScrapPack) === 674.65, [costBeforeProfit(base), costBeforeProfit(noScrapPack)]);
check('nothing to complain about for a good table', costingProblem(base) === '');

// ---- 6. saving and opening again
const saved = JSON.parse(JSON.stringify(serializeCosting(noScrapPack))); // what goes through the database as JSON
check('saving gives 14 rows', saved.length === 14);
check('the Final Cost row carries the final amount', saved[13].key === 'final' && saved[13].amount === 708.38, saved[13]);
check('a removed row stays removed in the saved data', saved[8].removed === true && saved[10].removed === true && !saved[2].removed);
const back = parseCosting(saved)!;
check('reading it back restores every input', back.weight === 0.9 && back.unit === 'kg' && back.matRate === 425 && back.forging === 225 && back.rejPct === 2 && back.machining === 55 && back.scrap === 135 && back.packing === 3 && back.profitPct === 5, back);
check('reading it back restores the removed rows', back.removed.join() === 'scrap,packing', back.removed);
check('and gives the same Final Cost', computeCosting(back).final === 708.38);
check('grams survive saving', parseCosting(JSON.parse(JSON.stringify(serializeCosting(grams))))!.unit === 'g');
check('the printed rows leave out the removed ones', printableRows(saved).length === 12 && printableRows(saved).every((x) => !x.removed));
check('the printed rows keep their fixed numbers', printableRows(saved).map((x) => x.no).join() === '1,2,3,4,5,6,7,8,10,12,13,14', printableRows(saved).map((x) => x.no));

// ---- 7. older quotations
const oldSheet = [{ label: 'Input Weight', basis: '900 grams', amount: null }, { label: 'Material', basis: '425 × 0.9 kg', amount: 382.5 }];
check('an older free-form cost sheet is not mistaken for the new table', parseCosting(oldSheet) === null && !isCosted({ costing: oldSheet }));
check('no cost sheet at all is not the new table', parseCosting(null) === null && !isCosted({ costing: null }) && finalCostOf({ costing: undefined }) === null);
check('a saved table is recognised and gives its Final Cost', isCosted({ costing: saved }) && finalCostOf({ costing: saved }) === 708.38);
check('rows that look like the new table but have an unknown key are not accepted', parseCosting([{ label: 'x', basis: '', amount: 1, key: 'nonsense' }]) === null);

// ---- 8. precision
check('no floating point crumbs (0.1 + 0.2 style)', amt({ ...base, weight: 0.3, matRate: 0.1, forging: 0.2, rejPct: 0, profitPct: 0, scrap: 0, machining: 0, packing: 0 }, 'rm') === 0.23, amt({ ...base, weight: 0.3, matRate: 0.1, forging: 0.2, rejPct: 0, profitPct: 0, scrap: 0, machining: 0, packing: 0 }, 'rm'));
check('every amount has at most 2 decimals', computeCosting({ ...base, weight: 0.777, matRate: 413.37, rejPct: 2.5, profitPct: 7.5 }).rows.every((x) => x.amount == null || Math.abs(x.amount * 100 - Math.round(x.amount * 100)) < 1e-9));


// ---- 9. the two printouts (Summary / Detailed)
const hdr = { docNo: 'QT-2026-0001', qtNo: 'QT-2026-0001', qtDate: '2026-11-18', validUntil: '2026-12-18', enquiryNo: '', customer: 'Acme Auto', contact: '', phone: '', email: '', paymentTerms: '30 days', deliveryTerms: 'Ex-works', remarks: '', amount: 569.78 } as unknown as QuotationRow;
const costedLine = (st: CostingState, product: string): QuotationLine => ({ product, grade: 'EN8', size: '45 mm', uom: 'PCS', qty: 1, rate: computeCosting(st).final, discountPct: 0, materialCost: null, processingCost: null, otherCost: null, costing: JSON.parse(JSON.stringify(serializeCosting(st))) });
const two = [costedLine(base, 'Flange'), costedLine(noScrapPack, 'Yoke')];
const summary = quotationHtml(hdr, two, {});
const detail = quotationHtml(hdr, two, { detailed: true });
const secret = ['Material', 'Forging Labour', 'Rejection', 'Machining', 'Scrap Recovery', 'Packing', 'Profit', 'Net Cost', 'Cost Before Profit', '382.50', '607.50', '27.13'];
check('SUMMARY shows the product names and each Final Cost', summary.includes('Flange') && summary.includes('Yoke') && summary.includes('569.78') && summary.includes('708.38'));
check('SUMMARY exposes none of the internal costing (material, labour, rejection, machining, scrap, packing, profit, subtotals)', secret.every((w) => !summary.includes(w)), secret.filter((w) => summary.includes(w)));
check('SUMMARY has no quantity / discount / total columns for these products', !summary.includes('>Qty<') && !summary.includes('Disc.') && !summary.includes('Amount in words'));
check('DETAILED has the full costing of both products', (detail.match(/Final Cost/g) ?? []).length === 3 && detail.includes('Material') && detail.includes('Rejection @ 2%') && detail.includes('382.50') && detail.includes('27.13'));
check('DETAILED shows whole amounts with 2 decimals and a deduction with a minus sign', detail.includes('>225.00<') && detail.includes('− 135.00'), detail.match(/Scrap Recovery.{0,120}/)?.[0]);
check('DETAILED shows the Final Cost of each table (569.78 and 708.38)', detail.includes('569.78') && detail.includes('708.38'));
check('DETAILED leaves out the removed rows of the second product', detail.split('Yoke')[detail.split('Yoke').length - 1].includes('Scrap Recovery') === false);
check('DETAILED still has Scrap Recovery for the first product (not removed there)', detail.includes('Scrap Recovery'));
const oldLine: QuotationLine = { product: 'Old bracket', grade: '', size: '', uom: 'PCS', qty: 10, rate: 100, discountPct: 10, materialCost: 50, processingCost: null, otherCost: null, netRate: 90, amount: 900, costing: null };
const oldHtml = quotationHtml({ ...hdr, amount: 900 } as QuotationRow, [oldLine], {});
check('an older quotation prints exactly as before (qty, rate, discount, total, amount in words)', oldHtml.includes('>Qty<') && oldHtml.includes('Disc.') && oldHtml.includes('Amount in words') && oldHtml.includes('Old bracket'));
const mixed = quotationHtml({ ...hdr, amount: 1469.78 } as QuotationRow, [oldLine, costedLine(base, 'Flange')], {});
check('a quotation mixing old and new products still prints with the full table', mixed.includes('>Qty<') && mixed.includes('Amount in words'));

console.log(failed ? `\n${failed} FAILED` : '\nAll costing checks passed');
process.exit(failed ? 1 : 0);
