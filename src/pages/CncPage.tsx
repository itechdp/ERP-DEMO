import { MachinePage } from '../machining/MachinePage';

/** Workflow → Machinery → CNC: the machines and the jobs run on them (see machining/MachinePage). */
export const CncPage = () => <MachinePage kind="cnc" />;
