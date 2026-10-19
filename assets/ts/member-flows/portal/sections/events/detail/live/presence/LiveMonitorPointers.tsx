import { Avatar } from "../../../../../../../ui/Avatar";
import type { JSX } from "preact";
import { LIVE_PRESENCE_OUTPUTS, type LivePresenceOutput } from "../../../../../../../../shared/live-room-presence";
import { useLivePresence, useLivePresenceController } from "./live-presence";
import "./LivePresence.css";

/** Whether a monitor shows a composition every operator sees the same way, so a pointer on it means the same spot. */
export function livePointerOutput(output: string): output is LivePresenceOutput {
  return (LIVE_PRESENCE_OUTPUTS as readonly string[]).includes(output);
}

const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Reports this operator's pointer on a monitor screen, in 0–1 coordinates of its 16:9 composition. */
export function useLivePointerReport(
  output: string,
): Pick<JSX.HTMLAttributes<HTMLDivElement>, "onPointerMove" | "onPointerLeave"> {
  const presence = useLivePresenceController();
  if (!presence || !livePointerOutput(output)) return {};
  return {
    onPointerMove: (event) => {
      const box = event.currentTarget.getBoundingClientRect();
      if (!box.width || !box.height) return;
      presence.point({
        output,
        x: clamp((event.clientX - box.left) / box.width),
        y: clamp((event.clientY - box.top) / box.height),
      });
    },
    onPointerLeave: () => presence.point(null),
  };
}

/** Other operators' pointers on one monitor: a dot in their color with their initials. */
export function LiveMonitorPointers({ output }: { output: string }) {
  const marks = useLivePresence().filter((mark) => mark.pointer?.output === output);
  if (!marks.length) return null;
  return (
    <svg class="pk-live-pointers" role="img" aria-label={`Pointing here: ${marks.map((mark) => mark.name).join(", ")}`}>
      {marks.map((mark) => (
        <svg
          key={mark.id}
          data-presence-color={mark.color}
          x={percent(mark.pointer!.x)}
          y={percent(mark.pointer!.y)}
          overflow="visible"
        >
          <circle class="pk-live-pointer__dot" r="5" />
          <foreignObject x="8" y="-12" width="24" height="24">
            <Avatar name={mark.name} class="pk-live-presence__avatar" />
          </foreignObject>
        </svg>
      ))}
    </svg>
  );
}
