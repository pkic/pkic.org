import type { ComponentChildren } from "preact";
import type { LiveSocketFactory } from "./useLiveSocket";
import { useLiveWindow } from "./useLiveWindow";

export interface SessionInteractionProps {
  slug: string;
  occurrenceId: string;
  startAt: string;
  endAt: string;
  createSocket?: LiveSocketFactory;
  closed?: ComponentChildren;
  showClosedControls?: boolean;
  labelledBy?: string;
}

/** Which window an interaction keeps to: the live room, or the longer one questions and polls take. */
export type SessionInteractionScope = "live" | "questions";

/** Keeps attendee interactions disconnected outside the canonical room window. */
export function SessionInteractionWindow({
  startAt,
  endAt,
  closed,
  showClosedControls,
  labelledBy,
  disabledControls,
  scope = "live",
  children,
}: SessionInteractionProps & {
  disabledControls: ComponentChildren;
  scope?: SessionInteractionScope;
  children: ComponentChildren;
}) {
  const open = useLiveWindow(startAt, endAt, scope);
  if (open) return <>{children}</>;
  if (!showClosedControls) return <>{closed}</>;
  return (
    <section aria-labelledby={labelledBy}>
      {closed}
      {disabledControls}
    </section>
  );
}
