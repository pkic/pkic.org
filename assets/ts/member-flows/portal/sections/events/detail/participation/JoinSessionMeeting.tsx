/**
 * Opens a session's external meeting (a workshop held on another meeting service, for example). The address is
 * issued per person only when they join, by the attendee endpoint that rechecks their entitlement.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { sessionVirtualRoomResponseSchema } from "../../../../../../../shared/schemas/event-session-virtual-room";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { getJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";

export function JoinSessionMeeting({
  slug,
  sessionId,
  primary,
  label = "Join online",
}: {
  slug: string;
  sessionId: string;
  primary: boolean;
  label?: string;
}) {
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1;
    setJoining(false);
    setJoinError("");
    return () => {
      generation.current += 1;
    };
  }, [slug, sessionId]);
  async function join() {
    if (joining) return;
    const current = generation.current;
    setJoining(true);
    setJoinError("");
    try {
      const response = await getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(sessionId)}/virtual-room`,
        sessionVirtualRoomResponseSchema,
      );
      if (current === generation.current) window.location.assign(response.url);
    } catch (error) {
      if (current === generation.current)
        setJoinError(error instanceof Error ? error.message : "The online session is unavailable. Please try again.");
    } finally {
      if (current === generation.current) setJoining(false);
    }
  }
  return (
    <>
      <Button variant={primary ? "primary" : "secondary"} loading={joining} onClick={() => void join()}>
        {label}
      </Button>
      {joinError && <ErrorAlert error={joinError} />}
    </>
  );
}
