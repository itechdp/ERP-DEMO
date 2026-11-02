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
  active: boolean;
}
