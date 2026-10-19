import {
  LIVE_AUTHOR_ROLES,
  inlineLiveAuthorRoles,
  orderLiveAuthorRoles,
  type LiveAuthorRole,
} from "../../shared/live-author-roles";
import { StrokeIcon } from "../ui/MediaIcons";
import { PkicMark } from "../ui/PkicMark";
import "./RoleMarks.css";

const ICONS: Record<Exclude<LiveAuthorRole, "member">, string> = {
  event_team: "M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4L2.2 6.3l4-.6z",
  speaker: "M8 2a2 2 0 0 1 2 2v4a2 2 0 0 1-4 0V4a2 2 0 0 1 2-2zM4.5 8a3.5 3.5 0 0 0 7 0M8 11.5V14",
  moderator: "M3 3h10v7H7l-3 3v-3H3z",
  host: "M4 14V2M4 3h7l-1.5 2.5L11 8H4",
  chair: "M3 12l1-7 4 3 4-3 1 7z",
  vice_chair: "M3 12l1-7 4 3 4-3 1 7zM6 14h4",
};

const ROLE = Object.fromEntries(LIVE_AUTHOR_ROLES.map((role) => [role.id, role])) as Record<
  LiveAuthorRole,
  (typeof LIVE_AUTHOR_ROLES)[number]
>;

/**
 * Role marks: a small icon in the role's color, membership as the PKIC mark.
 * Beside a name a mark is its icon alone, named for assistive technology and
 * in a tooltip; the person card lists every role in full with its name.
 */
export function RoleMarks({ roles, full = false }: { roles: readonly LiveAuthorRole[]; full?: boolean }) {
  const shown = full ? orderLiveAuthorRoles(roles) : inlineLiveAuthorRoles(roles);
  if (!shown.length) return null;
  return (
    <span class={`pk-live-roles${full ? " pk-live-roles--full" : ""}`}>
      {shown.map((role) => (
        <span key={role} class="pk-live-role" data-role={role} title={ROLE[role].label}>
          {role === "member" ? (
            <PkicMark class="pk-live-role__icon" />
          ) : (
            <StrokeIcon class="pk-live-role__icon">
              <path d={ICONS[role]} />
            </StrokeIcon>
          )}
          <span class={full ? undefined : "pk-sr-only"}>{ROLE[role].label}</span>
        </span>
      ))}
    </span>
  );
}
