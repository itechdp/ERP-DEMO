// The two accounting addresses with sub-pages: #/account-vouchers?view=… and #/accounting-report?view=…
// (one sidebar entry each, like the reference; every sub-page follows its page's access level).
import { ArrowLeftRight, ArrowUpFromLine, Banknote, BookOpen, Landmark, ScrollText, ShoppingBag, ShoppingCart, UserPlus, Wallet } from 'lucide-react';
import { PageHeader } from '../../components/ui';
import { NoAccess } from '../../pages/NoAccess';
import { useAccess } from '../../auth/access';
import { earliestDate } from '../engine';
import { FySelector, HubCard, av, useAccBooks, type HubCardDef } from '../components';
import { VIEW_KIND, VoucherForm, VoucherList } from './VoucherPages';
import { JournalForm, JournalList } from './JournalPages';
import { BillForm, BillList, ItemsPage } from './BillPages';
import { AccountForm, AccountsList } from './AccountPages';
import { LedgerList, LedgerView } from './LedgerPages';
import { BalanceSheet, DayBookList, DayBookView, ProfitLoss, ReceivablePayable, ReportHub } from './ReportPages';

const SECTIONS: { label: string; cards: HubCardDef[] }[] = [
  {
    label: 'Accounts & Billing',
    cards: [
      { title: 'Account', description: 'View all ledger accounts and add a new account — linked to a customer or supplier, or any other head.', icon: UserPlus, tone: 'violet', to: av('accounts'), linkText: 'View Accounts' },
      { title: 'Ledger', description: 'Pick an account and see its full statement — opening balance, every entry in order, and the running closing balance.', icon: ScrollText, tone: 'teal', to: av('ledger'), linkText: 'View Ledger' },
      { title: 'Sales Bill', description: 'Quickly record bills for customers with GST lines and record sales transactions.', icon: ShoppingCart, tone: 'blue', to: av('sales-bill') },
      { title: 'Purchase Bill', description: 'Record purchase bills from vendors and the purchase transactions.', icon: ShoppingBag, tone: 'green', to: av('purchase-bill') },
    ],
  },
  {
    label: 'Payments & Receipts',
    cards: [
      { title: 'Bank Receipt', description: 'Record money received into the bank.', icon: Landmark, tone: 'amber', to: av('bank-receipt') },
      { title: 'Bank Payment', description: 'Make payments from the bank for expenses and other payments.', icon: ArrowUpFromLine, tone: 'red', to: av('bank-payment') },
      { title: 'Cash Receipt', description: 'Record cash received from customers or other sources, with the notes received.', icon: Wallet, tone: 'amber', to: av('cash-receipt') },
      { title: 'Cash Payment', description: 'Handle cash payments for expenses and other payments, with the notes paid out.', icon: Banknote, tone: 'violet', to: av('cash-payment') },
    ],
  },
  {
    label: 'Cash & Journal Vouchers',
    cards: [
      { title: 'Journal Voucher', description: 'The most general voucher, used to record adjustments as journal entries.', icon: BookOpen, tone: 'blue', to: av('journal-voucher') },
      { title: 'Contra Entry', description: 'Transfer funds between cash and bank accounts.', icon: ArrowLeftRight, tone: 'teal', to: av('contra-entry') },
    ],
  },
];

function VouchersHub() {
  const { books } = useAccBooks();
  return (
    <>
      <PageHeader eyebrow="Accounting" title="Account Vouchers" actions={<FySelector earliest={books ? earliestDate(books) : null} />} />
      {SECTIONS.map((s) => (
        <section key={s.label} className="acct-sec">
          <h2 className="acct-sec-title">{s.label}</h2>
          <div className="acct-cards">
            {s.cards.map((c) => (
              <HubCard key={c.title} c={c} />
            ))}
          </div>
        </section>
      ))}
      <div className="acct-note-bar">
        <b>Note:</b> every voucher is saved in the books straight away, and can be viewed, printed, edited or deleted from its list or from the Ledger.
      </div>
    </>
  );
}

/** #/account-vouchers?view=… — a form opens with &new=1, &id=…(&mode=edit) or &draft=… */
export function AccountVouchersRouter({ query }: { query: URLSearchParams }) {
  const { canWrite } = useAccess();
  const view = query.get('view') ?? '';
  const isForm = query.has('new') || query.has('id') || query.has('draft');
  // a new / edited entry needs Write (a draft is approved with Write on Voucher Approvals) — even when typed into the address bar
  const needsWrite = query.has('new') || query.get('mode') === 'edit';
  if (needsWrite && !canWrite(query.has('draft') ? 'voucher_approvals' : 'account_vouchers')) return <NoAccess />;
  if (query.has('draft') && !canWrite('voucher_approvals')) return <NoAccess />;

  const kind = VIEW_KIND[view];
  if (kind) return isForm ? <VoucherForm kind={kind} query={query} /> : <VoucherList kind={kind} />;
  switch (view) {
    case 'journal-voucher':
      return isForm ? <JournalForm query={query} /> : <JournalList />;
    case 'sales-bill':
      return isForm ? <BillForm kind="sales" query={query} /> : <BillList kind="sales" />;
    case 'purchase-bill':
      return isForm ? <BillForm kind="purchase" query={query} /> : <BillList kind="purchase" />;
    case 'accounts':
      return <AccountsList />;
    case 'account':
      return <AccountForm query={query} />;
    case 'items':
      return <ItemsPage />;
    case 'ledger':
      return <LedgerList />;
    case 'ledger-view':
      return <LedgerView query={query} />;
    default:
      return <VouchersHub />;
  }
}

/** #/accounting-report?view=… */
export function AccountingReportRouter({ query }: { query: URLSearchParams }) {
  switch (query.get('view')) {
    case 'day-book':
      return query.get('date') ? <DayBookView date={query.get('date')!} /> : <DayBookList />;
    case 'receivable':
      return <ReceivablePayable which="receivable" />;
    case 'payable':
      return <ReceivablePayable which="payable" />;
    case 'balance-sheet':
      return <BalanceSheet />;
    case 'profit-loss':
      return <ProfitLoss />;
    default:
      return <ReportHub />;
  }
}
