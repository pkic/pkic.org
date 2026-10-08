import type { EventProposalSummary } from "./schemas/event-proposals";
import type { ContentAgendaDay } from "./site-agenda";

/** A proposal source card uses only the authorized list projection, never inferred speaker approval or timing. */
export function proposalAgendaContent(
  proposal: EventProposalSummary,
  durationMinutes?: number,
): ContentAgendaDay["slots"][number]["sessions"][number] {
  const proposerName = [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ");
  return {
    title: proposal.title,
    descriptionHtml: "",
    descriptionMarkdown: proposal.abstract,
    durationMinutes,
    locations: [],
    speakers: proposerName ? [{ name: proposerName, title: "Proposer" }] : [],
  };
}
