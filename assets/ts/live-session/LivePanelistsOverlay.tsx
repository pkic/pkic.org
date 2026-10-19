import type { LivePanelists, LiveRoomSession } from "../../shared/schemas/live-session-room";
import { SectionHeading } from "../ui/SectionHeading";
import { Avatar } from "../ui/Avatar";
import { liveCreditAffiliation } from "../../shared/live-room-credits";
import "../../design/tokens.agenda.generated.css";
import "./LivePanelistsOverlay.css";

/** The original event-session panel, vertical list and column views, using approved credits. */
export function LivePanelistsOverlay({
  session,
  panelists,
}: {
  session: LiveRoomSession;
  panelists: LivePanelists | null;
}) {
  if (!panelists) return null;
  return (
    <section class="pk-live-panelists" data-layout={panelists.layout} aria-label="Session panelists">
      <SectionHeading level={2} class="pk-live-panelists__session">
        {session.title}
      </SectionHeading>
      <div class="pk-live-panelists__credits">
        {session.credits.map((credit) => (
          <div class="pk-live-panelists__speaker" key={credit.key}>
            <div class="pk-live-panelists__headshot">
              <Avatar name={credit.name} src={credit.photoUrl ?? undefined} size="xl" original />
              {credit.moderator && <span class="pk-live-panelists__moderator">MODERATOR</span>}
            </div>
            <div class="pk-live-panelists__info">
              <div class="pk-live-panelists__name">{credit.name}</div>
              <div class="pk-live-panelists__title">{liveCreditAffiliation(credit)}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
