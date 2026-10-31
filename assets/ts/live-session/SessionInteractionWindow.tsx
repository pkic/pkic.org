import type { ComponentChildren } from "preact";
import type { LiveSocketFactory } from "./useLiveRoom";
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

/** Keeps attendee interactions disconnected outside the canonical room window. */
export function SessionInteractionWindow({
  startAt,
  endAt,
  closed,
  showClosedControls,
  labelledBy,
  disabledControls,
  children,
}: SessionInteractionProps & { disabledControls: ComponentChildren; children: ComponentChildren }) {
  const open = useLiveWindow(startAt, endAt);
  if (open) return <>{children}</>;
  if (!showClosedControls) return <>{closed}</>;
  return (
    <section aria-labelledby={labelledBy}>
      {closed}
      {disabledControls}
    </section>
  );
}
