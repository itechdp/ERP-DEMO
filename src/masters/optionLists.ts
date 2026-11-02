// The drop-down lists the user can edit (Settings → Drop-down Lists, and "+ Add new" inside the drop-down itself).
// Each entry is one list: its key (also known to the database, migration 42), the name shown, and the items it starts with.
// A list the user has never changed keeps these defaults; saving it stores the whole list in the database.
// To make another drop-down editable: add it here (and to _list_resource() in migration 42), then use useOptions(key) in the form.
export interface OptionList {
  key: string;
  label: string;
  hint: string;
  defaults: string[];
  /** items are numbers (shown with `unit`) */
  unit?: string;
}

export const OPTION_LISTS: OptionList[] = [
  {
    key: 'od_size',
    label: 'Bar sizes (OD)',
    hint: 'The OD / Size drop-down in Raw Material Inward.',
    unit: 'mm',
    defaults: ['12', '16', '20', '22', '25', '28', '30', '32', '35', '38', '40', '45', '50', '55', '60', '65', '70', '75', '80', '90', '100', '110', '120'],
  },
  {
    key: 'lost_reason',
    label: 'Quotation lost reasons',
    hint: 'The "Reason lost" drop-down when a quotation is marked Lost.',
    defaults: ['Price High', 'Delivery Time High', 'Customer Cancelled', 'Competitor Price Lower', 'Quality Issue', 'Customer Requirement Changed', 'Other'],
  },
  {
    key: 'payment_mode',
    label: 'Payment modes',
    hint: 'The Mode drop-down when a supplier payment is recorded.',
    defaults: ['Bank Transfer', 'Cheque', 'UPI', 'Cash'],
  },
  {
    key: 'department',
    label: 'Departments',
    hint: 'The Department drop-down on a Purchase Requisition.',
    defaults: ['Forge Shop', 'Machine Shop', 'Tool Room & Dies', 'Maintenance & Utilities', 'Quality Control (QC)', 'Stores & Raw Material', 'Admin & Facilities', 'Job Work & Heat Treatment'],
  },
];

export const optionList = (key: string) => OPTION_LISTS.find((l) => l.key === key);
export const defaultsOf = (key: string) => optionList(key)?.defaults ?? [];
