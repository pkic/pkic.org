import { useEffect, useState } from "preact/hooks";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { liveOverlayAccessResponseSchema } from "../../../../../../../shared/schemas/live-overlay-access";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { liveOverlayAddress, LIVE_OVERLAY_VIEWS } from "../../../../../../live-session/live-overlay-address";
import { postJson } from "../../../../../../shared/api-client";
import { CopyLinkRow } from "../../../../../../shared/widgets/copy-link-row";
import { Spinner } from "../../../../../../components/Spinner";

/**
 * A physical room's browser sources for one layout: one compact row per
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
  layout: { slug: string; name: string };
}) {
  const [access, setAccess] = useState<{ token: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<Error | null>(null);
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
  }, [slug, roomId]);
  if (error) return <ErrorAlert error={error} />;
  if (!access) return <Spinner label="Getting the links…" />;
  return (
    <div class="pk-stack">
      <div class="pk-stack pk-stack--snug">
        {LIVE_OVERLAY_VIEWS.map((view) => (
          <CopyLinkRow
            key={view.id}
            compact
            label={view.label}
            url={liveOverlayAddress(window.location.origin, {
              view: view.id,
              layout: layout.slug,
              slug,
              roomId,
              token: access.token,
            })}
          />
        ))}
      </div>
      <p class="pk-small pk-muted">These links stay the same and work until {formatDateTime(access.expiresAt)}.</p>
    </div>
  );
}
