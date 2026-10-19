import { useState } from "preact/hooks";
import { liveOverlayAccessResponseSchema } from "../../../../../../../shared/schemas/live-session-room";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { postJson } from "../../../../../../shared/api-client";
import { CopyLinkRow } from "../../../../../../shared/widgets/copy-link-row";
import { liveOverlayAddress, LIVE_OVERLAY_VIEWS } from "../../../../../../live-session/live-overlay-address";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Button } from "../../../../../../ui/Button";

/**
 * Stable broadcast browser sources for one physical room throughout its
 * program: one per output, each drawing the given layout. Load the same
 * output again with another layout for each scene in the production software.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function issue() {
    setBusy(true);
    setError(null);
    try {
      setAccess(
        await postJson(
          `/api/v1/events/${encodeURIComponent(slug)}/agenda/rooms/${encodeURIComponent(roomId)}/live/overlays`,
          {},
          liveOverlayAccessResponseSchema,
        ),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure : new Error("The overlay links could not be created."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div class="pk-stack">
      {error ? <ErrorAlert error={error} /> : null}
      {access ? (
        <>
          {LIVE_OVERLAY_VIEWS.map((view) => (
            <CopyLinkRow
              key={view.id}
              label={`${view.label}, ${layout.name}`}
              url={liveOverlayAddress(window.location.origin, {
                view: view.id,
                layout: layout.slug,
                slug,
                roomId,
                token: access.token,
              })}
            />
          ))}
          <p class="pk-small pk-muted">Sources expire {formatDateTime(access.expiresAt)}.</p>
        </>
      ) : null}
      <div class="pk-cluster">
        <Button loading={busy} onClick={() => void issue()}>
          {access ? "Refresh sources" : "Create sources"}
        </Button>
      </div>
    </div>
  );
}
