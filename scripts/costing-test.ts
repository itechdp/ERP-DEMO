// The 14-row quotation costing table: calculations, kg / gram, removing and restoring rows, checks, saving and reading back.
// Run: npm run test:costing
import { quotationHtml } from '../src/salesmod/print';
import type { QuotationLine, QuotationRow } from '../src/salesmod/types';
import { costBeforeProfit, computeCosting, r2, customProblems, dropBlankCustom, MAX_CUSTOM, rowNo, unitCostOf, costingErrors, costingMissing, costingProblem, emptyCosting, finalCostOf, isCosted, parseCosting, printableRows, serializeCosting, type CostingState } from '../src/salesmod/costing';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  → ${JSON.stringify(detail)}`}`);
};
const amt = (s: CostingState, key: string) => computeCosting(s).rows.find((r) => r.key === key)!.amount;

// the example from the client's sheet
const base: CostingState = { weight: 0.9, unit: 'kg', matRate: 425, forging: 225, forgingMode: 'amt', rejPct: 2, machining: 55, scrap: 135, scrapMode: 'amt', scrapRate: null, scrapG: null, packing: 3, profitPct: 5, removed: [], custom: [] };

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


// ---- 10. added cost rows ("+ Add Cost Row"): flat amounts on top of the profit
const withCustom = (...c: [string, number | null][]): CostingState => ({ ...base, custom: c.map(([name, amount]) => ({ name, amount })) });
check('no added rows: nothing changes (14 rows, Final Cost 569.78, calculation text as before)', computeCosting(base).rows.length === 14 && computeCosting(base).final === 569.78 && computeCosting(base).rows[13].basis === '542.65 + 27.13', computeCosting(base).rows[13].basis);
const c1 = computeCosting(withCustom(['Surface Treatment', 500]));
check('adding a custom row of 500 raises the Final Cost by exactly 500: 569.78 → 1069.78', c1.final === 1069.78 && r2(c1.final - 569.78) === 500, c1.final);
check('the custom row sits after Profit and before Final Cost, labelled with its name', c1.rows.map((r) => r.key).join() === 'weight,material,forging,rm,rejection,withRej,machining,withMach,scrap,net,packing,before,profit,custom,final' && c1.rows[13].label === 'Surface Treatment' && c1.rows[13].amount === 500 && c1.rows[13].basis === 'Added cost', c1.rows.map((r) => r.key).join());
check('the Final Cost row shows the numbers: 542.65 + 27.13 + 500.00', c1.rows[14].basis === '542.65 + 27.13 + 500.00', c1.rows[14].basis);
check('all 14 default rows are exactly as before (same amounts, same labels)', JSON.stringify(c1.rows.filter((r) => r.key !== 'custom' && r.key !== 'final').map((r) => [r.label, r.amount])) === JSON.stringify(computeCosting(base).rows.filter((r) => r.key !== 'final').map((r) => [r.label, r.amount])));
check('deleting the custom row takes the 500 off again: back to 569.78', computeCosting({ ...withCustom(['Surface Treatment', 500]), custom: [] }).final === 569.78);
const c2 = computeCosting(withCustom(['Surface Treatment', 500], ['Extra Charge', 250.5]));
check('two custom rows: 569.78 + 500 + 250.50 = 1320.28, and the total of added costs is 750.50', c2.final === 1320.28 && c2.customTotal === 750.5, [c2.final, c2.customTotal]);
check('the Final Cost text adds the custom rows together: 542.65 + 27.13 + 750.50', c2.rows[c2.rows.length - 1].basis === '542.65 + 27.13 + 750.50', c2.rows[c2.rows.length - 1].basis);
check('deleting one of two leaves the other: 569.78 + 250.50 = 820.28', computeCosting(withCustom(['Extra Charge', 250.5])).final === 820.28);
check('a custom row is flat: changing the profit % does not scale it (profit 10 %: 542.65 × 10 % = 54.27, + 500)', computeCosting({ ...withCustom(['Surface Treatment', 500]), profitPct: 10 }).final === r2(542.65 + 54.27 + 500));
check('with Profit removed the custom row still adds: 542.65 + 500 = 1042.65, and the text drops the profit', computeCosting({ ...withCustom(['Surface Treatment', 500]), removed: ['profit'] }).final === 1042.65 && computeCosting({ ...withCustom(['Surface Treatment', 500]), removed: ['profit'] }).rows.slice(-1)[0].basis === '542.65 + 500.00');
check('a row with no name still counts, labelled "Custom cost"', computeCosting(withCustom(['', 100])).rows[13].label === 'Custom cost' && computeCosting(withCustom(['', 100])).final === 669.78);
check('a row with no amount yet counts as 0', computeCosting(withCustom(['Surface Treatment', null])).final === 569.78);
check('a negative amount counts as 0 in the maths (and is flagged below)', computeCosting(withCustom(['Surface Treatment', -50])).final === 569.78);
check('amounts keep 2 decimals: 0.1 + 0.2 added → 570.08', computeCosting(withCustom(['a', 0.1], ['b', 0.2])).final === 570.08, computeCosting(withCustom(['a', 0.1], ['b', 0.2])).final);
check('the saved cost of a piece = Cost Before Profit + added costs (they are costs, not profit): 542.65 + 500 = 1042.65', unitCostOf(withCustom(['Surface Treatment', 500])) === 1042.65 && unitCostOf(base) === 542.65 && costBeforeProfit(withCustom(['x', 500])) === 542.65, [unitCostOf(withCustom(['x', 500])), costBeforeProfit(withCustom(['x', 500]))]);
check('so the margin stays honest: (1069.78 − 1042.65) ÷ 1069.78 is the profit share, not inflated by the added cost', r2(((1069.78 - unitCostOf(withCustom(['x', 500]))) / 1069.78) * 100) === 2.54);
// checks
check('a custom row needs both a name and an amount: name only → "Enter the amount."', customProblems(withCustom(['Surface Treatment', null]))[0] === 'Enter the amount.');
check('amount only → "Enter the cost name."', customProblems(withCustom(['', 500]))[0] === 'Enter the cost name.');
check('a negative amount is refused', customProblems(withCustom(['x', -1]))[0] === 'Cannot be negative.');
check('a completely empty row is not a problem (it is dropped when saving); a good row is fine; amount 0 is allowed', customProblems(withCustom(['', null], ['Surface Treatment', 500], ['Free', 0])).join('|') === '||');
check('the first problem names the row by its number: 15. Extra Charge: Enter the amount.', costingProblem(withCustom(['Surface Treatment', 500], ['Extra Charge', null])) === '15. Extra Charge: Enter the amount.', costingProblem(withCustom(['Surface Treatment', 500], ['Extra Charge', null])));
check('a good table with custom rows has no problem', costingProblem(withCustom(['Surface Treatment', 500])) === '');
check('weight problems are still reported first, correctly named, with custom rows present', costingProblem({ ...withCustom(['x', 1]), weight: null }).startsWith('1. Input Weight'));
check('dropBlankCustom removes only the completely empty rows', dropBlankCustom(withCustom(['', null], ['Surface Treatment', 500], ['  ', null], ['Free', 0])).custom.map((c) => c.name).join('|') === 'Surface Treatment|Free');
check('there is a limit on the number of added rows', MAX_CUSTOM === 20);
// saving and reading back
const savedC = JSON.parse(JSON.stringify(serializeCosting(withCustom(['Surface Treatment', 500], ['', 12.5]))));
check('saving gives the 14 rows plus one per added cost (16)', savedC.length === 16 && savedC.filter((r: any) => r.key === 'custom').length === 2);
check('the saved custom rows carry the name, amount, position and their numbers 14 and 15', savedC[13].key === 'custom' && savedC[13].label === 'Surface Treatment' && savedC[13].name === 'Surface Treatment' && savedC[13].amount === 500 && savedC[13].sub === 1 && savedC[13].no === 14 && savedC[14].sub === 2 && savedC[14].no === 15 && savedC[14].name === '', savedC.slice(13, 15));
check('the Final Cost row is still last, carries the final amount 1082.28, and is now numbered 16', savedC[15].key === 'final' && savedC[15].amount === 1082.28 && savedC[15].no === 16, savedC[15]);
const backC = parseCosting(savedC)!;
check('reading it back restores the added rows in order (a blank name stays blank)', backC.custom.length === 2 && backC.custom[0].name === 'Surface Treatment' && backC.custom[0].amount === 500 && backC.custom[1].name === '' && backC.custom[1].amount === 12.5, backC.custom);
check('and every other input comes back too, with the same Final Cost 1082.28', computeCosting(backC).final === 1082.28 && backC.weight === 0.9 && backC.profitPct === 5);
check('the table is still recognised as a costing table and gives its Final Cost', isCosted({ costing: savedC }) && finalCostOf({ costing: savedC }) === 1082.28);
const oldSaved = JSON.parse(JSON.stringify(serializeCosting(base)));
check('a table saved before added rows existed (14 rows) opens with none and the same Final Cost', parseCosting(oldSaved)!.custom.length === 0 && computeCosting(parseCosting(oldSaved)!).final === 569.78 && oldSaved.length === 14);
check('printed rows run in sequence 13, 14, 15, 16: Profit, the two added rows, then the Final Cost', printableRows(savedC).length === 16 && printableRows(savedC).map((r: any, i: number, all: any[]) => rowNo(r, i, all)).slice(12, 16).join() === '13,14,15,16', printableRows(savedC).map((r: any, i: number, all: any[]) => rowNo(r, i, all)));
// the two printouts
const hq = { docNo: 'QT-2026-0001', qtNo: 'QT-2026-0001', qtDate: '2026-11-19', validUntil: '2026-12-19', enquiryNo: '', customer: 'Acme Auto', contact: '', phone: '', email: '', paymentTerms: '30 days', deliveryTerms: 'Ex-works', remarks: '', amount: 1069.78 } as unknown as QuotationRow;
const cl = (st: CostingState): QuotationLine => ({ product: 'Flange', grade: 'EN8', size: '45 mm', uom: 'PCS', qty: 1, rate: computeCosting(st).final, discountPct: 0, materialCost: null, processingCost: null, otherCost: null, costing: JSON.parse(JSON.stringify(serializeCosting(st))) });
const stC = withCustom(['Surface Treatment', 500], ['Extra Charge', 250.5]);
const detC = quotationHtml(hq, [cl(stC)], { detailed: true });
const sumC = quotationHtml(hq, [cl(stC)], {});
check('DETAILED print includes each added row: name, amount 500.00 / 250.50, numbered 14 / 15, before the Final Cost', detC.includes('Surface Treatment') && detC.includes('Extra Charge') && detC.includes('>500.00<') && detC.includes('>250.50<') && detC.includes('<td>14</td><td>Surface Treatment') && detC.includes('<td>15</td><td>Extra Charge') && detC.indexOf('Extra Charge') < detC.lastIndexOf('Final Cost'), detC.match(/<td>14<\/td>.{0,120}/)?.[0]);
check('DETAILED print shows the Final Cost including them (1320.28) and the calculation text 542.65 + 27.13 + 750.50', detC.includes('1,320.28') && detC.includes('542.65 + 27.13 + 750.50'));
check('SUMMARY print shows only the product and the Final Cost 1,320.28, and none of the added rows or their names', sumC.includes('1,320.28') && !sumC.includes('Surface Treatment') && !sumC.includes('Extra Charge') && !sumC.includes('500.00') && !sumC.includes('Added cost') && !sumC.includes('Material'), ['Surface Treatment', 'Extra Charge', '500.00', 'Material'].filter((w) => sumC.includes(w)));


// ---- 11. numbering follows the rows: added rows are 14, 15 ..., the Final Cost comes after them
const nums = (st: CostingState) => computeCosting(st).rows.map((r) => `${r.no}:${r.key === 'custom' ? 'custom' : r.key}`).slice(12).join(' ');
check('no added row: Profit is 13 and the Final Cost is 14 (as before)', nums(base) === '13:profit 14:final', nums(base));
check('one added row: it is 14 and the Final Cost moves to 15', nums(withCustom(['Surface Treatment', 500])) === '13:profit 14:custom 15:final', nums(withCustom(['Surface Treatment', 500])));
check('two added rows: 14, 15 and the Final Cost is 16', nums(withCustom(['a', 1], ['b', 2])) === '13:profit 14:custom 15:custom 16:final', nums(withCustom(['a', 1], ['b', 2])));
check('five added rows: 14 to 18 and the Final Cost is 19', computeCosting({ ...base, custom: [1, 2, 3, 4, 5].map((n) => ({ name: `c${n}`, amount: n })) }).rows.slice(-1)[0].no === 19);
check('deleting one added row renumbers at once: back to one row (14) and the Final Cost 15', nums({ ...withCustom(['a', 1], ['b', 2]), custom: [{ name: 'b', amount: 2 }] }) === '13:profit 14:custom 15:final');
check('deleting the last added row puts the Final Cost back at 14', nums({ ...withCustom(['a', 1]), custom: [] }) === '13:profit 14:final');
check('rows 1 to 13 never change their numbers, however many rows are added', computeCosting({ ...base, custom: [1, 2, 3].map((n) => ({ name: `c${n}`, amount: n })) }).rows.slice(0, 13).map((r) => r.no).join() === '1,2,3,4,5,6,7,8,9,10,11,12,13');
check('the numbers go with the rows when saved and read back (re-saving after a delete renumbers)', (() => { const again = JSON.parse(JSON.stringify(serializeCosting({ ...parseCosting(savedC)!, custom: [parseCosting(savedC)!.custom[0]] }))); return again.length === 15 && again[13].no === 14 && again[14].key === 'final' && again[14].no === 15; })());
// a quotation saved by the earlier version stored the old numbers (13 for the added rows, 14 for the Final Cost): it still prints in sequence
const oldNumbered = [{ key: 'profit', no: 13 }, { key: 'custom', no: 13, sub: 1 }, { key: 'custom', no: 13, sub: 2 }, { key: 'final', no: 14 }] as any[];
check('rows saved with the older numbering (13 / 14) are printed in sequence 13, 14, 15, 16', oldNumbered.map((r, i, all) => rowNo(r, i, all)).join() === '13,14,15,16', oldNumbered.map((r, i, all) => rowNo(r, i, all)));
check('with no added rows rowNo gives the plain 1-14 numbers', [{ key: 'weight', no: 1 }, { key: 'final', no: 14 }].map((r: any, i, all) => rowNo(r, i, all as any[])).join() === '1,14');
check('DETAILED print of one added row numbers it 14 and the Final Cost 15', (() => { const h = quotationHtml(hq, [cl(withCustom(['Surface Treatment', 500]))], { detailed: true }); return h.includes('<td>14</td><td>Surface Treatment') && h.includes('<td>15</td><td>Final Cost') && !h.includes('<td>13.1</td>'); })());
check('DETAILED print of two added rows: 14, 15 and the Final Cost is 16', (() => { const h = quotationHtml(hq, [cl(stC)], { detailed: true }); return h.includes('<td>16</td><td>Final Cost') && !h.includes('<td>14</td><td>Final Cost'); })());
check('DETAILED print with no added rows still ends with 14 Final Cost', quotationHtml(hq, [cl(base)], { detailed: true }).includes('<td>14</td><td>Final Cost'));

console.log(failed ? `\n${failed} FAILED` : '\nAll costing checks passed');
process.exit(failed ? 1 : 0);
