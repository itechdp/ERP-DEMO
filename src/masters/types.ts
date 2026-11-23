export interface Customer {
  id: number;
  name: string;
  code: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  gstin: string;
  paymentTerms: string;
  notes: string;
  active: boolean;
}

/** a row of the machines / operators / inspectors lists (machines have a process stage) */
export interface MasterRow {
  id: number;
  name: string;
  stage?: string;
  /** plant staff only (the operators list, migration 85): Supervisor, Forger, Operator or Helper */
  designation?: string;
  active: boolean;
}

/** the designations a plant staff member can have (same list as save_staff in migration 85) */
export const STAFF_DESIGNATIONS = ['Supervisor', 'Forger', 'Operator', 'Helper'] as const;
