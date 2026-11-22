import { useEffect, useState } from "preact/hooks";

type LiveToggleDestination = "preview" | "program";
type LiveToggleSent = Partial<Record<LiveToggleDestination, boolean>>;

/** How long a sent toggle holds its button before the operator may try again, should the room never answer. */
export const LIVE_TOGGLE_PENDING_MS = 8000;

const isToggle = (destination: string): destination is LiveToggleDestination =>
  destination === "preview" || destination === "program";

/**
 * The PVW and PGM presses the room has not answered yet: each button shows
 * it is working at once and takes no second press, so a slow answer, such as
 * a check-in code the room signs first, never reads as a frozen click or
 * sends twice. A press ends when that output's state changes, when its send
 * fails, or after LIVE_TOGGLE_PENDING_MS.
 */
export function useLiveTogglePending(where: Record<LiveToggleDestination, boolean>) {
  // The state each output was in when its press was sent.
  const [sent, setSent] = useState<LiveToggleSent>({});
  const { preview, program } = where;
  const waiting = (destination: LiveToggleDestination) =>
    sent[destination] !== undefined && sent[destination] === where[destination];
  useEffect(() => {
    const now = { preview, program };
    const settled = (Object.keys(sent) as LiveToggleDestination[]).filter(
      (destination) => sent[destination] !== now[destination],
    );
    if (settled.length) return setSent((previous) => drop(previous, settled));
    if (!Object.keys(sent).length) return;
    const timeout = setTimeout(() => setSent({}), LIVE_TOGGLE_PENDING_MS);
    return () => clearTimeout(timeout);
  }, [sent, preview, program]);
  return {
    /** Whether this output's press is still on its way. */
    pending: (destination: LiveToggleDestination) => waiting(destination),
    /** Sends the press unless that output's last one is still on its way. Other outputs send at once. */
    press(destination: string, send: () => boolean) {
      if (!isToggle(destination)) return void send();
      if (waiting(destination)) return;
      if (send()) setSent((previous) => ({ ...previous, [destination]: where[destination] }));
    },
  };
}

function drop(sent: LiveToggleSent, destinations: readonly LiveToggleDestination[]): LiveToggleSent {
  const left = { ...sent };
  for (const destination of destinations) delete left[destination];
  return left;
}
