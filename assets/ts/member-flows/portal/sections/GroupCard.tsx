/**
 * A group in the portal's groups grid, in the collection card anatomy every
 * portal grid shares with the events grid.
 *
 * A group with a published working-group glyph keeps that group's cover
 * colors and mark. All Members carries the consortium mark with its member
 * arcs drawn strong, the icon the menu uses for members. Every other group
 * gets the default cover with its abbreviation or initials, at the same
 * height, so no card in the grid is shorter for having no picture.
 */
import { Avatar } from "../../../ui/Avatar";
import type { ComponentChildren } from "preact";
import type { Group } from "../../../../shared/schemas/groups";
import { PkicMark } from "../../../ui/PkicMark";
import { formatNumber } from "../../../../shared/format-number";
import { WorkingGroupIcon, workingGroupIconMarkup } from "../../../site/WorkingGroupIcon";
import { CollectionCard, type CollectionCardCover, type CollectionStatus } from "../../../ui/CollectionCard";
import type { HeadingTag } from "../../../ui/HeadingOutline";

/** Groups whose published cover colors the stylesheet carries. */
const THEMED_COVERS = new Set(["cbom", "cm", "pkimm", "pqc", "tcwg"]);

function groupCover(group: Pick<Group, "abbreviatedName" | "name" | "type">): CollectionCardCover {
  const key = group.abbreviatedName?.toLowerCase() ?? "";
  // The community every member belongs to wears the members mark the menu uses.
  if (group.type.key === "community") return { glyph: <PkicMark highlight="arcs" /> };
  return {
    class: THEMED_COVERS.has(key) ? `pk-discovery-cover--${key}` : undefined,
    glyph: workingGroupIconMarkup(key) ? (
      <WorkingGroupIcon name={key} />
    ) : (
      <Avatar name={group.name} shape="square" size="xl" />
    ),
  };
}

/**
 * The name without a trailing kind the card's label already says:
 * "Post-Quantum Cryptography" under a "Working group" label, not
 * "Post-Quantum Cryptography Working Group".
 */
function cardTitle(group: Pick<Group, "name" | "type">): string {
  const suffix = ` ${group.type.singularLabel}`;
  const trimmed = group.name.toLowerCase().endsWith(suffix.toLowerCase())
    ? group.name.slice(0, -suffix.length).trim()
    : group.name;
  return trimmed || group.name;
}

export function groupHref(group: Pick<Group, "id">): string {
  return `#/groups/${encodeURIComponent(group.id)}/overview`;
}

export function GroupCard({
  group,
  heading,
  status,
  statusLabel,
  actions,
}: {
  group: Group;
  heading: HeadingTag;
  status?: readonly CollectionStatus[];
  statusLabel?: string;
  actions?: ComponentChildren;
}) {
  return (
    <CollectionCard
      heading={heading}
      title={cardTitle(group)}
      href={groupHref(group)}
      kind={group.type.singularLabel}
      cover={groupCover(group)}
      meta={group.parentGroup ? `Part of ${group.parentGroup.name}` : undefined}
      summary={group.description ?? undefined}
      status={status}
      statusLabel={statusLabel}
      fact={`${formatNumber(group.participantCount)} ${group.participantCount === 1 ? "participant" : "participants"}`}
      actions={actions}
    />
  );
}
