/**
 * The viewer's own registration standing for an event, linked to that
 * registration: the portal Home upcoming-events panel's line. It draws the
 * same badges the events list and its cards draw ("Registered · in person"),
 * from the same derivation.
 */
import { Link } from "wouter";
import type { EventViewerState } from "../../../../../shared/schemas/event-management";
import { CollectionStatusLine } from "../../../../ui/CollectionCard";
import { eventViewerStatus } from "./event-viewer-status";

export function ViewerEventState({ viewer, href }: { viewer: EventViewerState; href?: string }) {
  const badges = <CollectionStatusLine items={eventViewerStatus({ viewer })} />;
  return href ? (
    <Link href={href} class="pk-small">
      {badges}
    </Link>
  ) : (
    badges
  );
}
