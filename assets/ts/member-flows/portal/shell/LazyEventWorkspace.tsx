import { lazy, Suspense } from "preact/compat";

import { Spinner } from "../../../components/Spinner";
import type { EventWorkspaceProps } from "../sections/events/EventWorkspace";

const EventWorkspace = lazy(() =>
  import("../sections/events/EventWorkspace").then((module) => ({ default: module.EventWorkspace })),
);

/** The event workspace behind its own suspense boundary, as every route under `/events` wants it. */
export function LazyEventWorkspace(props: EventWorkspaceProps) {
  return (
    <Suspense fallback={<Spinner />}>
      <EventWorkspace {...props} />
    </Suspense>
  );
}
