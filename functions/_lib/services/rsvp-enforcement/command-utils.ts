import { sha256Hex } from "../../utils/crypto";

export function rsvpOutboxId(kind: "warning" | "action", candidateId: string): Promise<string> {
  return sha256Hex(`calendar_rsvp:${kind}:${candidateId}`).then((hex) => hex.slice(0, 32));
}
