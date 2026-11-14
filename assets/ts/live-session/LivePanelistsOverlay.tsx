import { formatClockRangeInZone } from "../../shared/format-date";
import type { OverlayRect } from "../../shared/live-overlay-geometry";
import type { LiveCredit, LivePanelists, LiveRoomSession } from "../../shared/schemas/live-session-room";
import { SectionHeading } from "../ui/SectionHeading";
import { Avatar } from "../ui/Avatar";
import { LiveBoard, liveBoardSize, type LiveBoardShape } from "./LiveBoard";
import { LiveCreditTitles } from "./LiveCreditTitles";
import "./LivePanelistsOverlay.css";

/** The most people a panel seats, the moderator included; one row holds them all on a wide board. */
export const LIVE_PANEL_SEATS = 6;

/**
 * How the people sit on the board: side by side in one row, in a grid, or one
 * under the other. The operator's view is the wish; the board's shape decides
 * what fits: a column beside the camera always lists them, and a row never
 * holds more than a panel's seats.
 */
export type LivePanelistsArrangement = "row" | "grid" | "rows";
export function livePanelistsArrangement(
  layout: LivePanelists["layout"],
  shape: LiveBoardShape,
  count: number,
): LivePanelistsArrangement {
  if (layout === "list" || shape === "tall") return count > LIVE_PANEL_SEATS ? "grid" : "rows";
  if (layout === "columns") return "grid";
  return count <= LIVE_PANEL_SEATS && (shape === "wide" || shape === "strip" || count <= 3) ? "row" : "grid";
}

/** The speakers first, in the session's order, then the moderator who leads them. */
function seated(credits: readonly LiveCredit[]): LiveCredit[] {
  return [...credits.filter((credit) => !credit.moderator), ...credits.filter((credit) => credit.moderator)];
}

/**
 * The session's title and its people, each with their photo, name and the
 * titles they speak under, the moderator set apart, arranged for the board's
 * shape. The panelists' board draws them alone; the panel board draws them
 * under the audience question.
 */
export function LivePanelistsCredits({
  session,
  panelists,
  shape,
}: {
  session: LiveRoomSession;
  panelists: LivePanelists;
  shape: LiveBoardShape;
}) {
  const people = seated(session.credits);
  const arrangement = livePanelistsArrangement(panelists.layout, shape, people.length);
  const firstModerator = people.findIndex((credit) => credit.moderator);
  return (
    <>
      <div class="pk-live-panelists__heading">
        <SectionHeading level={2} class="pk-live-board__headline pk-live-panelists__session">
          {session.title}
        </SectionHeading>
        <span class="pk-live-board__stripe" />
      </div>
      <div
        class="pk-live-panelists__credits"
        data-layout={panelists.layout}
        data-arrangement={arrangement}
        data-count={Math.min(people.length, LIVE_PANEL_SEATS)}
      >
        {people.map((credit, index) => (
          <div
            class="pk-live-panelists__speaker"
            key={credit.key}
            data-moderator={credit.moderator ? "" : undefined}
            data-set-apart={index > 0 && index === firstModerator ? "" : undefined}
          >
            <div class="pk-live-panelists__headshot">
              <Avatar name={credit.name} src={credit.photoUrl ?? undefined} size="xl" original />
              {credit.moderator ? <p class="pk-live-panelists__moderator">Moderator</p> : null}
            </div>
            <div class="pk-live-panelists__info">
              <p class="pk-live-panelists__name">{credit.name}</p>
              <div class="pk-live-panelists__title">
                <LiveCreditTitles credit={credit} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * The session's speakers on the conference board, under its time. Two
 * speakers sit large side by side; a panel of up to six fits one row across a
 * wide board, and a column lists them.
 */
export function LivePanelistsOverlay({
  session,
  panelists,
  box,
}: {
  session: LiveRoomSession;
  panelists: LivePanelists | null;
  box: Pick<OverlayRect, "width" | "height">;
}) {
  if (!panelists) return null;
  return (
    <LiveBoard
      box={box}
      class="pk-live-panelists"
      label="Session panelists"
      eyebrow={formatClockRangeInZone(session.startAt, session.endAt, session.timeZone)}
    >
      <LivePanelistsCredits session={session} panelists={panelists} shape={liveBoardSize(box).shape} />
    </LiveBoard>
  );
}
