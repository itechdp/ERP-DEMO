// ---------------------------------------------------------------------------
// DEMO credentials shown on the login page (they only pre-fill the form). The accounts themselves live in Supabase Auth
// (created by supabase/seed_demo.sql) and the role comes from profiles.role. Delete this file and the credentials card
// on the login page when the demo is over.
// ---------------------------------------------------------------------------
import type { Role } from './access';

export interface DemoUser {
  role: Role;
  email: string;
  password: string;
  name: string;
  /** short label for the login tabs */
  tab: string;
}

export const DEMO_USERS: DemoUser[] = [
  { role: 'director', email: 'director@forgeflow.local', password: 'Dir@12345', name: 'Director', tab: 'Director' },
  { role: 'plant_head', email: 'planthead@forgeflow.local', password: 'Plant@12345', name: 'Plant Head', tab: 'Plant Head' },
  { role: 'accounts', email: 'accounts@forgeflow.local', password: 'Acc@12345', name: 'Accounts Team', tab: 'Accounts' },
  { role: 'qc', email: 'qc@forgeflow.local', password: 'Qc@12345', name: 'QC Inspector', tab: 'QC' },
  { role: 'operator', email: 'operator@forgeflow.local', password: 'Op@12345', name: 'Operator', tab: 'Operator' },
  { role: 'viewer', email: 'viewer@forgeflow.local', password: 'View@12345', name: 'Viewer', tab: 'Viewer' },
  { role: 'supervisor', email: 'supervisor@forgeflow.local', password: 'Super@12345', name: 'Supervisor', tab: 'Supervisor' },
];

