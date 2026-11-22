import { useEffect, useState } from "preact/hooks";
import { liveOverlayAccessResponseSchema } from "../../../../../../../shared/schemas/live-overlay-access";
import {
  liveRoomOutputsResponseSchema,
  type LiveRoomOutput,
  type LiveRoomOutputInput,
} from "../../../../../../../shared/schemas/live-room-output-setup";
import type { LiveOverlayView } from "../../../../../../../shared/schemas/live-session-room";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { liveOverlayAddress } from "../../../../../../live-session/live-overlay-address";
import type { LiveOverlayGraphics } from "../../../../../../live-session/live-overlay-graphics";
import { getJson, postJson, putJson } from "../../../../../../shared/api-client";
import { Button } from "../../../../../../ui/Button";
import { LiveRoomScreens } from "./LiveRoomScreens";

/**
 * A physical room's screens and their links, loaded together. The room
 * gives the same links each time, until a day after its program ends. A
 * studio picks up a change to the screens when it next opens.
 */
export function LiveOverlayLinks({
  slug,
  roomId,
  scenes,
}: {
  slug: string;
  roomId: string;
  /** The event's scenes, by name, for a screen's Scene. */
  scenes: ReadonlyArray<{ slug: string; name: string }>;
}) {
  const base = `/api/v1/events/${encodeURIComponent(slug)}/agenda/rooms/${encodeURIComponent(roomId)}/live`;
  const [access, setAccess] = useState<{ token: string; expiresAt: string } | null>(null);
  const [screens, setScreens] = useState<LiveRoomOutput[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Bumped by Try again, so a failed load can repeat without leaving the page.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setAccess(null);
    setScreens(null);
    setError(null);
    Promise.all([
      postJson(`${base}/overlays`, {}, liveOverlayAccessResponseSchema),
      getJson(`${base}/outputs`, liveRoomOutputsResponseSchema),
    ]).then(
      ([issued, listed]) => {
        if (!current) return;
        setAccess(issued);
        setScreens(listed.outputs);
      },
      (cause: unknown) =>
        current && setError(cause instanceof Error ? cause : new Error("The screens could not be loaded.")),
    );
    return () => {
      current = false;
    };
  }, [base, attempt]);
  if (error)
    return (
      <div class="pk-stack pk-stack--snug">
        <ErrorAlert error={error} />
        <div>
          <Button variant="secondary" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </Button>
        </div>
      </div>
    );
  if (!access || !screens) return <Spinner label="Getting the screens…" />;
  const link = (view: LiveOverlayView, graphics?: LiveOverlayGraphics) =>
    liveOverlayAddress(window.location.origin, { view, layout: null, slug, roomId, token: access.token, graphics });
  const save = async (outputs: LiveRoomOutputInput[]) => {
    const saved = await putJson(`${base}/outputs`, { outputs }, liveRoomOutputsResponseSchema);
    setScreens(saved.outputs);
  };
  return <LiveRoomScreens screens={screens} scenes={scenes} expiresAt={access.expiresAt} link={link} onSave={save} />;
}
