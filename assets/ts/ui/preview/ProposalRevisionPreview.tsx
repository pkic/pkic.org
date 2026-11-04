import { ParticipantSubmission } from "../../components/events/ParticipantSubmission";
import { proposalAccessReadResponseSchema } from "../../../shared/schemas/proposal-management";
import { eventFormsResponseSchema } from "../../../shared/schemas/forms";

const eventId = "10000000-0000-4000-8000-000000000001";
const data = proposalAccessReadResponseSchema.parse({
  success: true,
  proposal: {
    id: "30000000-0000-4000-8000-000000000001",
    event_id: eventId,
    proposer_user_id: "20000000-0000-4000-8000-000000000001",
    status: "needs-work",
    proposal_type: "talk",
    title: "Post-quantum migration",
    abstract: "A practical case study of migrating a working certificate authority.",
    committee_notes: null,
    details: null,
    revision_request: { note: "Narrow the scope to one migration story.", decided_at: "2026-10-20T10:00:00.000Z" },
  },
  speakers: [],
});
const forms = eventFormsResponseSchema.parse({
  event: { id: eventId, slug: "example-conference", name: "Example Conference" },
  purpose: "proposal_submission",
  form: null,
  registrationPolicy: "public",
  requiredTerms: [],
  allowedSessionTypes: ["talk"],
  eventDays: [],
});
export function ProposalRevisionPreview() {
  return (
    <ParticipantSubmission
      data={data}
      forms={forms}
      event={{ startsAt: null, endsAt: null, timezone: "UTC" }}
      facet="submission"
      reload={async () => {}}
    />
  );
}
