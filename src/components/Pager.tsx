// Paging for list pages, one shared piece:
//   · usePaged(rows)   — the list is already in the browser (most pages: the data is loaded whole): cut it into pages
//   · usePager()+<Pager/> with  fetchPage()  (src/db/paged.ts) — the list is long and grows for ever (the ledger, sales orders …): the DATABASE
//     returns one page at a time and the total, so the browser never holds the whole table
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { fmtNum } from './format';

export const PAGE_SIZES = [10, 25, 50, 100];

export interface PagerState {
  page: number;
  size: number;
  setPage: (p: number) => void;
  setSize: (n: number) => void;
}

/** the page number and page size; the page goes back to 1 whenever `resetKey` (the filters) or the size changes */
export function usePager(resetKey: unknown = '', initialSize = 25): PagerState {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialSize);
  useEffect(() => setPage(1), [resetKey, size]);
  return { page, size, setPage, setSize };
}

/** a list that is already in memory → this page's rows + the pager to put under the table */
export function usePaged<T>(rows: T[], resetKey: unknown = '', initialSize = 25): { rows: T[]; pager: JSX.Element | null; total: number } {
  const p = usePager(resetKey, initialSize);
  const pages = Math.max(1, Math.ceil(rows.length / p.size));
  const page = Math.min(p.page, pages);
  const slice = useMemo(() => rows.slice((page - 1) * p.size, page * p.size), [rows, page, p.size]);
  return { rows: slice, total: rows.length, pager: rows.length > PAGE_SIZES[0] ? <Pager total={rows.length} page={page} size={p.size} onPage={p.setPage} onSize={p.setSize} /> : null };
}

export function Pager({ total, page, size, onPage, onSize }: { total: number; page: number; size: number; onPage: (p: number) => void; onSize: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(total, page * size);
  return (
    <div className="pager">
      <span className="muted">
        {fmtNum(from)}–{fmtNum(to)} of {fmtNum(total)}
      </span>
      <span className="pager-sp" />
      <label className="muted">
        Rows per page{' '}
        <select value={size} onChange={(e) => onSize(Number(e.target.value))} aria-label="Rows per page">
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button className="icon-btn" title="First page" aria-label="First page" disabled={page <= 1} onClick={() => onPage(1)}>
        <ChevronsLeft size={16} />
      </button>
      <button className="icon-btn" title="Previous page" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeft size={16} />
      </button>
      <span className="pager-no">
        Page {page} of {pages}
      </span>
      <button className="icon-btn" title="Next page" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        <ChevronRight size={16} />
      </button>
      <button className="icon-btn" title="Last page" aria-label="Last page" disabled={page >= pages} onClick={() => onPage(pages)}>
        <ChevronsRight size={16} />
      </button>
    </div>
  );
}
