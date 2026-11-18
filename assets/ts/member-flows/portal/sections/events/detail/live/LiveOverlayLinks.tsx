import { useEffect, useState } from "preact/hooks";
import { Button } from "../../../../../../ui/Button";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { liveOverlayAccessResponseSchema } from "../../../../../../../shared/schemas/live-overlay-access";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { liveOverlayAddress, LIVE_OVERLAY_VIEWS } from "../../../../../../live-session/live-overlay-address";
import { postJson } from "../../../../../../shared/api-client";
import { CopyLinkRow } from "../../../../../../shared/widgets/copy-link-row";
import { Spinner } from "../../../../../../components/Spinner";
import type { LiveOverlayView } from "../../../../../../../shared/schemas/live-session-room";
import type { LiveOverlayGraphics } from "../../../../../../live-session/live-overlay-graphics";
import { LiveOverlayGraphicsDialog } from "./LiveOverlayGraphicsDialog";

/**
 * A physical room's browser sources, drawing the scene on air or always one: one compact row per
 * output with its copy control. The room gives the same links each time, so
 * they load as soon as they show, until a day after its program ends.
 */
export function LiveOverlayLinks({
  slug,
  roomId,
  layout,
}: {
  slug: string;
  roomId: string;
  /** The scene every link always draws; null to draw the scene each output has on air. */
  layout: string | null;
}) {
  const [access, setAccess] = useState<{ token: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Bumped by Try again, so a failed load can repeat without leaving the page.
  const [attempt, setAttempt] = useState(0);
  // The output whose link is being narrowed to some graphics.
  const [narrowing, setNarrowing] = useState<LiveOverlayView | null>(null);
  useEffect(() => {
    let current = true;
    setAccess(null);
    setError(null);
    postJson(
      `/api/v1/events/${encodeURIComponent(slug)}/agenda/rooms/${encodeURIComponent(roomId)}/live/overlays`,
      {},
      liveOverlayAccessResponseSchema,
    ).then(
      (issued) => current && setAccess(issued),
      (failure: unknown) =>
        current && setError(failure instanceof Error ? failure : new Error("The output links could not be loaded.")),
    );
    return () => {
      current = false;
    };
  }, [slug, roomId, attempt]);
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
  if (!access) return <Spinner label="Getting the links…" />;
  const link = (view: LiveOverlayView, graphics?: LiveOverlayGraphics) =>
    liveOverlayAddress(window.location.origin, { view, layout, slug, roomId, token: access.token, graphics });
  const narrowed = LIVE_OVERLAY_VIEWS.find((view) => view.id === narrowing);
  return (
    <div class="pk-stack">
      <div class="pk-stack pk-stack--snug">
        {LIVE_OVERLAY_VIEWS.map((view) => (
          <CopyLinkRow
            key={view.id}
            compact
            label={view.label}
            url={link(view.id)}
            actions={
              // The stage display draws its own speaker screen, not graphics to choose from.
              view.id === "stage-display" ? null : (
                <Button variant="ghost" onClick={() => setNarrowing(view.id)}>
                  Show only some graphics…
                </Button>
              )
            }
          />
        ))}
      </div>
      <p class="pk-small pk-muted">These links stay the same and work until {formatDateTime(access.expiresAt)}.</p>
      {narrowed ? (
        <LiveOverlayGraphicsDialog
          label={narrowed.label}
          link={(graphics) => link(narrowed.id, graphics)}
          onClose={() => setNarrowing(null)}
        />
      ) : null}
    </div>
  );
}
