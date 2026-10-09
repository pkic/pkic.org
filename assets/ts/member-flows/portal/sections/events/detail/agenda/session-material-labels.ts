import type { SessionMaterial } from "../../../../../../../shared/schemas/event-session-history";

export const materialStatusLabels: Record<SessionMaterial["status"], string> = {
  draft: "Draft — private",
  approved: "Approved for publication",
  withdrawn: "Withdrawn",
  failed: "Review failed",
};
export const materialKindLabels: Record<SessionMaterial["kind"], string> = {
  presentation: "Slides",
  recording: "Recording",
  transcript: "Transcript",
  captions: "Captions",
};
