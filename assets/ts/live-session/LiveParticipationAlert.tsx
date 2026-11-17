import { useEffect, useState } from "preact/hooks";
import { formatClockInZone } from "../../shared/format-date";
import { LIVE_PARTICIPATION_POLICY, liveRestrictionActive } from "../../shared/live-moderation-policy";
import type { LiveParticipationRestrictionView } from "../../shared/schemas/live-session-moderation";
import { Alert } from "../ui/Alert";

/**
 * This viewer's block in force, or null. A pause ends by itself, so the hook
 * re-renders when it runs out instead of waiting for the room to say so.
 */
export function useLiveParticipation(
  restriction: LiveParticipationRestrictionView | null | undefined,
): LiveParticipationRestrictionView | null {
  const [, rerender] = useState(0);
  const until = restriction?.until ? Date.parse(restriction.until) : null;
  useEffect(() => {
    if (until === null || until <= Date.now()) return;
    const timer = setTimeout(() => rerender((tick) => tick + 1), until - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [until]);
  return restriction && liveRestrictionActive(restriction, Date.now()) ? restriction : null;
}

/** In place of every way to post: why this person can't, and that watching goes on. */
export function LiveParticipationAlert({
  restriction,
  timeZone,
  eventName,
}: {
  restriction: LiveParticipationRestrictionView;
  timeZone: string;
  eventName?: string;
}) {
  const conduct = (
    <>
      You can keep watching. Please read our <a href="/code-of-conduct/">Code of Conduct</a>.
    </>
  );
  if (restriction.block === "paused")
    return (
      <Alert
        tone="warn"
        title={`You're paused until ${restriction.until ? formatClockInZone(restriction.until, timeZone) : "later"}.`}
      >
        A moderator paused your posting for {LIVE_PARTICIPATION_POLICY.pauseMinutes} minutes. {conduct}
      </Alert>
    );
  if (restriction.block === "session")
    return (
      <Alert tone="warn" title="You can't post in this session.">
        A moderator blocked your posting for this session. {conduct}
      </Alert>
    );
  return (
    <Alert tone="warn" title="You can't post at this event.">
      A moderator blocked your posting at {eventName ?? "this event"}. {conduct}
    </Alert>
  );
}
