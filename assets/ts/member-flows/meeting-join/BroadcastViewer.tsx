import { useEffect, useState } from "preact/hooks";
import { meetingJoinLandingSchema, type MeetingJoinLanding } from "../../../shared/schemas/meeting-entry";
import { getJson } from "../../shared/api-client";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { Panel, PanelBody } from "../../ui/Panel";
import "../../ui/Content.css";

/** A portal gate controls entry to this page; YouTube links can still be reshared. */
export function BroadcastViewer({
  landing,
  embedUrl,
  destination,
}: {
  landing: MeetingJoinLanding;
  embedUrl: string;
  destination: string;
}) {
  const [accessError, setAccessError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let checking = false;
    async function checkAccess() {
      if (checking) return;
      checking = true;
      try {
        const current = await getJson(
          `/api/v1/meetings/occurrences/${encodeURIComponent(landing.occurrence.id)}/join`,
          meetingJoinLandingSchema,
        );
        if (!cancelled && current.landingRevision !== landing.landingRevision) {
          setAccessError("The event or its terms have changed. Reopen the invitation to review your access.");
        }
      } catch {
        if (!cancelled)
          setAccessError(
            "Your viewing access could not be confirmed. Reopen the invitation to sign in or check your eligibility.",
          );
      } finally {
        checking = false;
      }
    }
    const timer = window.setInterval(() => void checkAccess(), 30_000);
    window.addEventListener("focus", checkAccess);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", checkAccess);
    };
  }, [landing]);

  return (
    <Panel>
      <PanelBody class="pk-stack">
        <div class="pk-stack pk-stack--tight">
          <h1>{landing.occurrence.eventName}</h1>
          <p class="pk-muted">
            Watching as {landing.name}
            {landing.affiliation ? ` (${landing.affiliation})` : ""}
          </p>
        </div>
        {accessError ? (
          <>
            <Alert tone="warn">{accessError}</Alert>
            <Button onClick={() => window.location.reload()}>Reopen invitation</Button>
          </>
        ) : (
          <>
            <iframe
              key={reload}
              class="pk-embed pk-framed"
              src={embedUrl}
              title={`${landing.occurrence.eventName} broadcast`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
            <div class="pk-cluster">
              <Button onClick={() => setReload((value) => value + 1)}>Reload player</Button>
              <a href={destination} target="_blank" rel="noopener noreferrer">
                Video not playing? Open on YouTube
              </a>
            </div>
            <p class="pk-small pk-muted">
              Your invitation controls access to this page. YouTube links can be saved or shared. Opening the player
              does not verify attendance.
            </p>
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
