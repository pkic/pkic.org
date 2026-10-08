import { lazy, Suspense } from "preact/compat";
import type { ComponentProps } from "preact";
import type { AgendaConflictDetails } from "./AgendaConflictDetails";
import { Spinner } from "../../../../../../components/Spinner";

const ConflictDetails = lazy(() =>
  import("./AgendaConflictDetails").then((module) => ({ default: module.AgendaConflictDetails })),
);

export function LazyAgendaConflictDetails(props: ComponentProps<typeof AgendaConflictDetails>) {
  return (
    <Suspense fallback={<Spinner label="Loading schedule conflict details…" />}>
      <ConflictDetails {...props} />
    </Suspense>
  );
}
