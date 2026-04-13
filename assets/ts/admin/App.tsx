import { isAuthed } from "./state";
import { Login } from "./shell/Login";
import { AdminShell } from "./shell/AdminShell";

/**
 * Root component — gates on auth state.
 *
 * `isAuthed` is a computed signal: it re-evaluates whenever `authToken`
 * changes, causing this component to swap between Login and AdminShell
 * without a full page reload.
 */
export function App() {
  return isAuthed.value ? <AdminShell /> : <Login />;
}
