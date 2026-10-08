import { lazy, Suspense } from "preact/compat";
import type { ComponentProps } from "preact";
import { Spinner } from "../../../../../../components/Spinner";
import { SessionEditorDialog } from "./SessionEditorDialog";

const BreakDialog = lazy(() => import("./AgendaBreakDialog").then((module) => ({ default: module.AgendaBreakDialog })));

/** Calendar creation keeps its context behind the appropriate focused dialog. */
export function AgendaCreationDialogs({
  session,
  breaks,
}: {
  session?: ComponentProps<typeof SessionEditorDialog>;
  breaks?: ComponentProps<typeof BreakDialog>;
}) {
  return (
    <>
      {session && <SessionEditorDialog {...session} />}
      {breaks && (
        <Suspense fallback={<Spinner label="Loading break editor…" />}>
          <BreakDialog {...breaks} />
        </Suspense>
      )}
    </>
  );
}
