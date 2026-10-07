import { lazy, Suspense } from "preact/compat";
import type { ComponentProps } from "preact";
import { Spinner } from "../../../../../../components/Spinner";

const Library = lazy(() => import("./ContentLibrary").then((module) => ({ default: module.ContentLibrary })));
const Staffing = lazy(() => import("./StaffingEditor").then((module) => ({ default: module.StaffingEditor })));
const Import = lazy(() => import("./AgendaImport").then((module) => ({ default: module.AgendaImport })));

export function ContentLibrary(props: ComponentProps<typeof Library>) {
  return (
    <Suspense fallback={<Spinner label="Loading session library…" />}>
      <Library {...props} />
    </Suspense>
  );
}
export function StaffingEditor(props: ComponentProps<typeof Staffing>) {
  return (
    <Suspense fallback={<Spinner label="Loading block roles…" />}>
      <Staffing {...props} />
    </Suspense>
  );
}
export function AgendaImport(props: ComponentProps<typeof Import>) {
  return (
    <Suspense fallback={<Spinner label="Loading accepted proposal import…" />}>
      <Import {...props} />
    </Suspense>
  );
}
