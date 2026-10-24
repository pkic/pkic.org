import { useState } from "preact/hooks";
import type { PreviewSection } from "./PreviewShell";
import { DataTable } from "../../components/Table";
import { Panel, PanelHeader, PanelBody } from "../Panel";
import { agendaSnapshotSchema } from "../../../shared/schemas/event-agenda";
import { speakerProfileReviewSchema } from "../../../shared/schemas/event-speaker-profile-reviews";
import {
  ProfileReviewDialog,
  speakerProfileReviewColumns,
} from "../../member-flows/portal/sections/events/detail/agenda/SpeakerProfileReviews";

const profile = speakerProfileReviewSchema.parse({
  userId: "10000000-0000-4000-8000-000000000001",
  identityId: "10000000-0000-4000-8000-000000000002",
  organizationId: "10000000-0000-4000-8000-000000000003",
  displayName: "Alex Example",
  organizationName: "Example Security",
  jobTitle: "Cryptography researcher",
  biography:
    "Alex researches practical approaches to post-quantum migration and helps engineering teams adopt cryptographic agility.\n\nTheir current work focuses on testing, interoperability, and clear guidance for organizations planning their transition.",
  photoUrl: null,
  links: ["https://example.org/alex"],
  sessionCount: 3,
  profileDigest: "a".repeat(64),
  reviewedAt: null,
  available: true,
});
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "gallery-speaker-review",
  timeZone: "Europe/Amsterdam",
  revision: 4,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  shifts: [],
  assignments: [],
  roleMembers: [],
});
function SpeakerProfileReviewSpecimen() {
  const [open, setOpen] = useState(false);
  return (
    <div class="pk-stack">
      <Panel>
        <PanelHeader title="Speaker profiles" />
        <PanelBody>
          <p>Review the canonical profile once for this speaker’s sessions. Changes need another review.</p>
          <DataTable
            caption="Speaker profile reviews"
            data={[profile]}
            rowKey={(row) => row.userId}
            columns={speakerProfileReviewColumns(true, () => setOpen(true))}
          />
        </PanelBody>
      </Panel>
      {open && (
        <ProfileReviewDialog
          snapshot={snapshot}
          profile={profile}
          onSaved={() => setOpen(false)}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
export const speakerProfileReviewSections: PreviewSection[] = [
  {
    id: "speaker-profile-review",
    title: "Speaker profile review",
    note: "Event-level profile approval, shared table rows and review dialog. The gallery uses a synthetic speaker.",
    render: () => <SpeakerProfileReviewSpecimen />,
  },
];
