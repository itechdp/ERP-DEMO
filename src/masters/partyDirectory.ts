import type { Customer } from './types';

// The customer master as last loaded by the store (empty for roles that may not see party names). Printouts read a customer's
// address and GSTIN from here, so every print shows the full party block without each page having to pass it along.
let customers: Customer[] = [];

export const setCustomerDirectory = (list: Customer[]) => {
  customers = list;
};

export const customerByName = (name: string): Customer | undefined => {
  const n = name.trim().toLowerCase();
  return n ? customers.find((c) => c.name.trim().toLowerCase() === n) : undefined;
};

/** a party's address lines and GSTIN as printable text: [address, "City, State", "GSTIN: …"] (only what is filled in) */
export const partyLines = (p?: { address?: string | null; city?: string | null; state?: string | null; gstin?: string | null; phone?: string | null }) =>
  !p
    ? []
    : [
        (p.address ?? '').trim(),
        [p.city, p.state].map((x) => (x ?? '').trim()).filter(Boolean).join(', '),
        (p.gstin ?? '').trim() ? `GSTIN: ${(p.gstin ?? '').trim().toUpperCase()}` : '',
        (p.phone ?? '').trim() ? `Phone: ${(p.phone ?? '').trim()}` : '',
      ].filter(Boolean);
