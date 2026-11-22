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
  layout: Exclude<LivePanelists["layout"], "title">,
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
 * The session's title, its abstract when the operator shows it, and its
 * people, each with their photo, name and the titles they speak under, the
 * moderator last, arranged for the board's shape; or the title alone. The
 * session board draws them alone; the panel board draws the people alone
 * under the audience question, so the question has the room the title took.
 */
export function LivePanelistsCredits({
  session,
  panelists,
  shape,
  titled = true,
}: {
  session: LiveRoomSession;
  panelists: LivePanelists;
  shape: LiveBoardShape;
  titled?: boolean;
}) {
  const { layout } = panelists;
  const people = layout === "title" ? [] : seated(session.credits);
  const abstract = titled && panelists.abstract ? session.abstract : null;
  return (
    <>
      {titled ? (
        <div class="pk-live-panelists__heading">
          <SectionHeading level={2} class="pk-live-board__headline pk-live-panelists__session">
            {session.title}
          </SectionHeading>
          <span class="pk-live-board__stripe" />
        </div>
      ) : null}
      {abstract ? <p class="pk-live-panelists__abstract">{abstract}</p> : null}
      {layout === "title" || !people.length ? null : (
        <div
          class="pk-live-panelists__credits"
          data-layout={layout}
          data-arrangement={livePanelistsArrangement(layout, shape, people.length)}
          data-count={Math.min(people.length, LIVE_PANEL_SEATS)}
        >
          {people.map((credit) => (
            <div class="pk-live-panelists__speaker" key={credit.key} data-moderator={credit.moderator ? "" : undefined}>
              <div class="pk-live-panelists__headshot">
                <Avatar name={credit.name} src={credit.photoUrl ?? undefined} size="xl" original />
                {credit.moderator ? <p class="pk-live-panelists__moderator">Moderator</p> : null}
              </div>
              <div class="pk-live-panelists__info">
                <p class="pk-live-panelists__name">
                  {credit.name}
                  {credit.moderator ? <span class="pk-live-panelists__role">Moderator</span> : null}
                </p>
                <div class="pk-live-panelists__title">
                  <LiveCreditTitles credit={credit} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The session on the conference board, under its time: its title, with its
 * abstract when the operator shows it, and its speakers. One or two speakers
 * sit large side by side; a panel of up to six fits one row across a wide
 * board, and a column lists them. Title only leaves the people out.
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
      class={panelists.layout === "title" ? "pk-live-panelists pk-live-panelists--title" : "pk-live-panelists"}
      label="Session"
      eyebrow={formatClockRangeInZone(session.startAt, session.endAt, session.timeZone)}
    >
      <LivePanelistsCredits session={session} panelists={panelists} shape={liveBoardSize(box).shape} />
    </LiveBoard>
  );
}
