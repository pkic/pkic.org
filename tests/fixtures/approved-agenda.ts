import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import fixture from "./site-publication.json";

export const approvedAgendaInstant = "2026-12-01T09:00:00.000Z";
export const approvedAgendaSnapshot = agendaSnapshotSchema.parse({
  eventSlug: "approved-event",
  timeZone: "Europe/Amsterdam",
  revision: 3,
  publishedRevision: 3,
  approvedAt: approvedAgendaInstant,
  rooms: [{ id: "hall", name: "Main hall", capacity: 100 }],
  blocks: [],
  assignments: [],
  roleMembers: [],
  occurrences: [
    {
      id: "session",
      title: "Approved session",
      description: "A sufficiently detailed approved description for the public session archive.",
      startAt: approvedAgendaInstant,
      endAt: "2026-12-01T10:00:00.000Z",
      roomId: "hall",
      speakers: [{ userId: "person", displayName: "Current profile name", role: "moderator" }],
      history: {
        appearances: [
          {
            userId: "person",
            actingIdentityId: null,
            displayName: "Historical speaker",
            jobTitle: "Engineer",
            organizationName: "Historical organization",
            biography: "**Approved biography** <script>unsafe()</script>",
            photoUrl: "/approved-photo.jpg",
            approvedAt: approvedAgendaInstant,
          },
        ],
        materials: [
          {
            id: "slides",
            kind: "presentation",
            title: "Approved slides",
            url: "/approved-slides.pdf",
            presentationVersionId: null,
            version: 1,
            rightsConfirmed: true,
            consentConfirmed: true,
            validated: true,
            status: "approved",
            approvedAt: approvedAgendaInstant,
          },
          {
            id: "private",
            kind: "recording",
            title: "Unreleased recording",
            url: "https://example.test/private",
            presentationVersionId: null,
            version: 1,
            rightsConfirmed: false,
            consentConfirmed: true,
            validated: true,
            status: "draft",
            approvedAt: null,
          },
        ],
      },
    },
  ],
});
export const approvedAgendaPublication = sitePublicationSnapshotSchema.parse({
  ...fixture,
  eventAgendas: { "approved-event": approvedAgendaSnapshot },
});
