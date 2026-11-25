import { lazy, Suspense } from "preact/compat";

import { Spinner } from "../../../../../../components/Spinner";

const SponsorTiersTab = lazy(async () => {
  const module = await import("./SponsorTiersTab");
  return { default: module.SponsorTiersTab };
});

const EventSponsorsPanel = lazy(async () => {
  const module = await import("./sponsors/EventSponsorsPanel");
  return { default: module.EventSponsorsPanel };
});

/** The event's own sponsors, when the event is known, above the tiers that may read attendee data. */
export function LazySponsorTiersTab({
  eventId,
  ...props
}: {
  slug: string;
  canWrite: boolean;
  endpoint?: string;
  eventId?: string;
}) {
  return (
    <Suspense fallback={<Spinner label="Loading sponsors…" />}>
      <div class="pk-stack">
        {eventId && <EventSponsorsPanel eventId={eventId} canWrite={props.canWrite} />}
        <SponsorTiersTab {...props} />
      </div>
    </Suspense>
  );
}
