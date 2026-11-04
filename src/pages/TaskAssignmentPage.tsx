import { SalesListPage } from './SalesPages';

/** Main Menu → Work Hub → Task Assignment: the task list and the form to give a task to somebody. Its own page, listed under the Work Hub. */
export function TaskAssignmentPage({ query }: { query: URLSearchParams }) {
  return <SalesListPage route="task-assignment" query={query} />;
}
