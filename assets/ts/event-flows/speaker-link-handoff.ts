import { getJson } from "../shared/api-client";
import {
  speakerSelfServiceReadResponseSchema,
  type SpeakerSelfServiceReadResponse,
} from "../../shared/schemas/speaker-self-service";
import { proposalSpeakerAccessPath } from "../../shared/proposal-access-paths";
import { loadSpeakerPageData } from "./speaker-link-recovery";

/** Existing emailed links hand off to the account-owned speaker view. */
export async function handoffSpeakerLink(
  selector: string,
  facet: "participation" | "presentations" = "participation",
  navigate: (destination: string) => void = (destination) => window.location.replace(destination),
): Promise<void> {
  const loaded = await loadSpeakerPageData<SpeakerSelfServiceReadResponse>({
    selector,
    request: (token, boot) =>
      getJson(proposalSpeakerAccessPath(boot.apiBase, token), speakerSelfServiceReadResponseSchema),
  });
  if (!loaded) return;
  const { boot, data } = loaded;
  const eventPath = `/portal/#/events/${encodeURIComponent(boot.eventSlug)}`;
  if (!data.speaker.userId) {
    navigate(`${eventPath}/submissions`);
    return;
  }
  navigate(
    `${eventPath}/proposals/${encodeURIComponent(data.proposal.id)}/${facet}?speaker=${encodeURIComponent(data.speaker.userId)}`,
  );
}
