import type { SpeakerRole } from "../../shared/schemas/registration";

export const SPEAKER_ROLE_OPTIONS = [
  { value: "proposer", label: "Proposer" },
  { value: "speaker", label: "Speaker" },
  { value: "co_speaker", label: "Co-speaker" },
  { value: "moderator", label: "Moderator" },
  { value: "panelist", label: "Panelist" },
] as const satisfies ReadonlyArray<{ value: SpeakerRole; label: string }>;
