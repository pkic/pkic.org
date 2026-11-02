import type { EventPromotionDesign } from "./schemas/event-promotion-design";
import type { AgendaMediaCapabilities } from "./event-agenda-media";

/** A capture plan never claims that a recording is already available. */
export function promotionMediaWording(
  design: Pick<EventPromotionDesign, "advertiseLiveStreaming" | "advertiseRecordings">,
  media: AgendaMediaCapabilities,
  recordingUrl?: string | null,
): string | undefined {
  const wording = [
    ...(design.advertiseLiveStreaming && media.liveStreaming ? ["In person and online"] : []),
    ...(design.advertiseRecordings && media.recording
      ? [recordingUrl ? "On-demand recording available" : "Recording planned"]
      : []),
  ];
  return wording.length ? wording.join(" · ") : undefined;
}
