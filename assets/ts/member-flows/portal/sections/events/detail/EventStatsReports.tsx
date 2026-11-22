/** The analytics sections that load a report of their own, each in its own chunk. */
import { lazy, Suspense } from "preact/compat";
import type { ClockZone } from "../../../../../../shared/event-clock";
import { Spinner } from "../../../../../ui/Spinner";

const SessionDemandReport = lazy(() =>
  import("./SessionDemandReport").then((module) => ({ default: module.SessionDemandReport })),
);
const SessionPopularityReport = lazy(() =>
  import("./SessionPopularityReport").then((module) => ({ default: module.SessionPopularityReport })),
);
const UnfinishedRegistrations = lazy(() =>
  import("./UnfinishedRegistrations").then((module) => ({ default: module.UnfinishedRegistrations })),
);
const Promoters = lazy(() => import("./Promoters").then((module) => ({ default: module.Promoters })));

/** Sections served by a report here rather than by the event's analytics data. */
export const EVENT_STATS_REPORT_SECTIONS: readonly string[] = [
  "session-demand",
  "session-popularity",
  "unfinished-registrations",
  "promoters",
];

export function EventStatsReport({
  section,
  slug,
  clock,
  subTab,
  basePath,
}: {
  section: string;
  slug: string;
  clock?: ClockZone;
  subTab?: string;
  basePath: string;
}) {
  return section === "session-demand" ? (
    <Suspense fallback={<Spinner label="Loading session demand…" />}>
      <SessionDemandReport slug={slug} clock={clock} />
    </Suspense>
  ) : section === "session-popularity" ? (
    <Suspense fallback={<Spinner label="Loading session popularity…" />}>
      <SessionPopularityReport slug={slug} clock={clock} />
    </Suspense>
  ) : section === "unfinished-registrations" ? (
    <Suspense fallback={<Spinner label="Loading unfinished registrations…" />}>
      <UnfinishedRegistrations slug={slug} />
    </Suspense>
  ) : section === "promoters" ? (
    <Suspense fallback={<Spinner label="Loading promoters…" />}>
      <Promoters slug={slug} subTab={subTab} basePath={`${basePath}/promoters`} />
    </Suspense>
  ) : null;
}
