import { lazy, Suspense } from "preact/compat";

import { Spinner } from "../../../../../../components/Spinner";

const SponsorTiersTab = lazy(async () => {
  const module = await import("./SponsorTiersTab");
  return { default: module.SponsorTiersTab };
});

/** The event's own sponsors, when the event is known, with the tiers that may read attendee data or scan leads. */
export function LazySponsorTiersTab(props: { slug: string; canWrite: boolean; endpoint?: string; eventId?: string }) {
  return (
    <Suspense fallback={<Spinner label="Loading sponsors…" />}>
      <SponsorTiersTab {...props} />
    </Suspense>
  );
}
