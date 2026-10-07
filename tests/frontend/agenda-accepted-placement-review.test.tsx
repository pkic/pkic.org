// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  acceptedProposalPlacementBody,
  previewAcceptedProposalPlacement,
  applyAcceptedProposalPlacement,
} from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/accepted-proposal-placement";
import { agendaImportSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
const proposalId = "10000000-0000-4000-8000-000000000001";
const roomId = "20000000-0000-4000-8000-000000000001";
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "synthetic",
  timeZone: "UTC",
  revision: 4,
  publishedRevision: null,
  rooms: [{ id: roomId, name: "Workshop", capacity: 40 }],
  occurrences: [],
  blocks: [],
  roleMembers: [],
  assignments: [],
});

afterEach(() => vi.unstubAllGlobals());
it("binds immediate placement to the exact preview fingerprint and preserves source-change refusals", async () => {
  const requests: ReturnType<typeof agendaImportSchema.parse>[] = [];
  let refusal = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const request = agendaImportSchema.parse(JSON.parse(String(init.body)));
      requests.push(request);
      if (refusal)
        return Response.json(
          {
            error: { code: "AGENDA_PROPOSAL_REVIEW_CHANGED", message: "The accepted proposal changed. Review again." },
          },
          { status: 409 },
        );
      return Response.json({
        agenda: snapshot,
        imported: 1,
        skipped: 0,
        dryRun: request.dryRun,
        reviewRequired: 0,
        placementFingerprint: "a".repeat(64),
      });
    }),
  );
  const body = acceptedProposalPlacementBody(snapshot, proposalId, {
    startAt: "2026-12-01T09:00:00.000Z",
    endAt: "2026-12-01T09:30:00.000Z",
    roomId,
  });
  const fingerprint = await previewAcceptedProposalPlacement(snapshot, body);
  expect(requests[0]).toMatchObject({ dryRun: true, expectedRevision: 4, proposalIds: [proposalId] });
  refusal = true;
  await expect(applyAcceptedProposalPlacement(snapshot, body, fingerprint)).rejects.toThrow(
    "The accepted proposal changed.",
  );
  refusal = false;
  const result = await applyAcceptedProposalPlacement(snapshot, body, fingerprint);
  expect(result.agenda).toEqual(snapshot);
  expect(requests.at(-1)).toMatchObject({
    dryRun: false,
    expectedPlacementFingerprint: "a".repeat(64),
    expectedRevision: 4,
    proposalIds: [proposalId],
    proposalPlacement: {
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T09:30:00.000Z",
      roomId,
      additionalRoomIds: [],
    },
  });
});
