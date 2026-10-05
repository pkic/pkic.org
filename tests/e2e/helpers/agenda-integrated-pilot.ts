import { randomUUID } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";
import ICAL from "ical.js";
import {
  agendaSnapshotSchema,
  agendaRoomCreateSchema,
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaImportSchema,
  agendaImportResponseSchema,
  agendaStaffingSchema,
  type AgendaOccurrence,
} from "../../../assets/shared/schemas/event-agenda";
import {
  eventSeriesCreateSchema,
  eventSeriesResponseSchema,
  eventOccurrencesListResponseSchema,
  eventOccurrenceUpdateSchema,
  eventOccurrenceResponseSchema,
} from "../../../assets/shared/schemas/event-series";
import { groupMemberAddBodySchema, groupMembershipMutationResponseSchema } from "../../../assets/shared/schemas/groups";
import {
  meetingAgendaSchema,
  meetingAgendaSaveSchema,
  meetingAgendaPublishSchema,
  publishedMeetingAgendaResponseSchema,
} from "../../../assets/shared/schemas/meeting-agenda";
import {
  speakerSelfServiceReadResponseSchema,
  speakerProfileUpdateResponseSchema,
} from "../../../assets/shared/schemas/speaker-self-service";
import {
  speakerSelfProfilePatchSchema,
  coSpeakerInviteSchema,
  coSpeakerInviteResponseSchema,
} from "../../../assets/shared/schemas/proposal-management";
import { eventProposalProofVerifyResponseSchema } from "../../../assets/shared/schemas/event-proposal-proof";
import { userCreateSchema, userCreateResponseSchema } from "../../../assets/shared/schemas/user-create";
import {
  userRolesListResponseSchema,
  accessGrantCreateSchema,
  accessGrantCreateResponseSchema,
} from "../../../assets/shared/schemas/access-control";
import { sessionHistoryCorrectionSchema } from "../../../assets/shared/schemas/event-session-history";
import { dateTimeLocalToIso } from "../../../assets/shared/timezone";
import { createMember } from "./member-provisioning";
import { signInToPortal } from "./portal-auth";
import { submitProposal, decideProposal } from "./proposals";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import { acceptVisibleTerms, fieldLabel } from "./proposal-entry-ui";
import { confirmSpeakerWithReceipt } from "./speaker-participation-receipt";
import { runRowAction } from "./data-table";
import { sponsorEventSlug } from "./sponsor-live-fixture";

export const pilotAgendaApi = `/api/v1/events/${sponsorEventSlug}/agenda`;
export const pilotAgendaPage = `/portal/#/events/${sponsorEventSlug}/agenda`;

export async function readPilotAgenda(page: Page) {
  const response = await page.request.get(pilotAgendaApi);
  expect(response.status(), await response.text()).toBe(200);
  return agendaSnapshotSchema.parse(await response.json());
}

export async function capturePilot(page: Page, info: TestInfo, phase: string) {
  for (const [label, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`${phase}-${label}.png`), fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

/** A real canonical member is used for meeting participation and, later, independently granted door duties. */
export async function preparePilotMeeting(staff: Page, participant: Page, groupId: string, info: TestInfo) {
  const member = await createMember(staff, { individual: true });
  const seated = await staff.request.post(`/api/v1/groups/${groupId}/memberships/${member.userId}`, {
    data: groupMemberAddBodySchema.parse({ capacitySelection: { mode: "all_eligible", confirmed: true } }),
  });
  expect(seated.status(), await seated.text()).toBe(200);
  expect(
    groupMembershipMutationResponseSchema
      .parse(await seated.json())
      .memberships.some((row) => row.userId === member.userId),
  ).toBe(true);
  const created = await staff.request.post(`/api/v1/groups/${groupId}/meetings/series`, {
    data: eventSeriesCreateSchema.parse({
      eventName: `Integrated recurring pilot ${randomUUID()}`,
      eventSlug: `integrated-meeting-${randomUUID()}`,
      profileKey: "meeting",
      policy: {
        registrationPolicy: "no_registration",
        memberEligibility: "owner_group",
        guestPolicy: "occurrence_invitation",
      },
      startsAt: new Date(Date.now() + 3_600_000).toISOString(),
      recurrenceRule: "FREQ=WEEKLY;COUNT=3",
      timezone: "Europe/Amsterdam",
      durationMinutes: 60,
      location: "Synthetic meeting room",
      providerType: null,
    }),
  });
  expect(created.status(), await created.text()).toBe(201);
  const { series } = eventSeriesResponseSchema.parse(await created.json());
  const base = `/api/v1/groups/${groupId}/meetings/series/${series.id}`;
  const listed = await staff.request.get(`${base}/occurrences?limit=5&offset=0&sort=starts_at`);
  expect(listed.status()).toBe(200);
  const occurrences = eventOccurrencesListResponseSchema.parse(await listed.json()).occurrences;
  expect(occurrences).toHaveLength(3);
  const [first, second] = occurrences;
  if (!first || !second) throw new Error("The recurring pilot requires two independent occurrences");
  const updated = await staff.request.patch(`${base}/occurrences/${first.id}`, {
    data: eventOccurrenceUpdateSchema.parse({
      expectedUpdatedAt: first.updatedAt,
      locationOverride: "Pilot occurrence room",
    }),
  });
  expect(updated.status()).toBe(200);
  expect(eventOccurrenceResponseSchema.parse(await updated.json()).occurrence.id).toBe(first.id);
  const unchanged = await staff.request.get(`${base}/occurrences/${second.id}`);
  expect(eventOccurrenceResponseSchema.parse(await unchanged.json()).occurrence).toEqual(second);
  const template = meetingAgendaSchema.parse(await (await staff.request.get(`${base}/agenda`)).json());
  const itemId = randomUUID();
  const saved = await staff.request.post(`${base}/agenda`, {
    data: meetingAgendaSaveSchema.parse({
      expectedRevision: template.revision,
      expectedWriteRevision: template.writeRevision,
      expectedFormatVersion: template.formatVersion,
      scope: "template",
      name: "Integrated meeting format",
      items: [{ id: itemId, title: "Shared agenda review", durationMinutes: 30, speakerUserIds: [member.userId] }],
    }),
  });
  expect(saved.status(), await saved.text()).toBe(200);
  meetingAgendaSchema.parse(await saved.json());
  for (const occurrence of [first, second]) {
    const draft = meetingAgendaSchema.parse(
      await (await staff.request.get(`${base}/agenda?occurrenceId=${occurrence.id}`)).json(),
    );
    const published = await staff.request.post(`${base}/occurrences/${occurrence.id}/agenda/publications`, {
      data: meetingAgendaPublishSchema.parse({ expectedRevision: draft.revision }),
    });
    expect(published.status(), await published.text()).toBe(200);
    expect(meetingAgendaSchema.parse(await published.json()).items[0]?.id).toBe(itemId);
  }
  await signInToPortal(participant, member.email);
  const personalCalendar = await participant.request.get(`${base}/calendar.ics?personal=true`);
  expect(personalCalendar.status(), await personalCalendar.text()).toBe(200);
  const calendar = await personalCalendar.text();
  const master = new ICAL.Component(ICAL.parse(calendar)).getFirstSubcomponent("vevent");
  if (!master) throw new Error("The participant must receive a native series event");
  expect(master.getFirstPropertyValue("uid")).toBe(`${series.id}@pkic.org`);
  expect(master.getFirstPropertyValue("rrule")).toMatchObject({ freq: "WEEKLY", count: 3 });
  expect(master.getFirstPropertyValue("attendee")).toBe(`mailto:${member.email}`);
  const singleCalendar = await participant.request.get(`${base}/calendar.ics?personal=true&occurrenceId=${first.id}`);
  expect(singleCalendar.status()).toBe(200);
  const single = new ICAL.Component(ICAL.parse(await singleCalendar.text())).getAllSubcomponents("vevent");
  expect(single).toHaveLength(1);
  expect(single[0]!.getFirstPropertyValue("uid")).toBe(`${first.id}@pkic.org`);
  expect(new ICAL.Event(single[0]!).startDate.toJSDate().toISOString()).toBe(first.startsAt);
  expect(single[0]!.getFirstPropertyValue("attendee")).toBe(`mailto:${member.email}`);
  const visible = await participant.request.get(`${base}/occurrences/${first.id}/agenda/published`);
  expect(visible.status()).toBe(200);
  const agenda = publishedMeetingAgendaResponseSchema.parse(await visible.json()).agenda;
  expect(agenda?.items[0]).toMatchObject({ id: itemId, speakerUserIds: [member.userId] });
  await participant.goto(`/portal/#/groups/${groupId}/meetings/${series.id}/occurrences/${first.id}`);
  await expect(participant.getByRole("heading", { name: "Integrated meeting format", exact: true })).toBeVisible();
  await expect(participant.getByRole("heading", { name: "Shared agenda review", exact: true })).toBeVisible();
  await expect(participant.getByText("Approved agenda · Europe/Amsterdam", { exact: true })).toBeVisible();
  await expect(participant.getByRole("region", { name: "Occurrence settings", exact: true })).toHaveCount(0);
  await capturePilot(participant, info, "pilot-recurring-meeting");
  return { member, seriesId: series.id, eventId: series.eventId, occurrenceIds: occurrences.map((row) => row.id) };
}

/** The speaker's actual proof/confirmation feeds the accepted source imported into this same agenda. */
export async function preparePilotSpeaker(staff: Page, speaker: Page, info: TestInfo) {
  const email = `integrated-speaker-${randomUUID()}@example.test`;
  const title = `Integrated speaker session ${randomUUID()}`;
  const proposal = await submitProposal(staff, {
    proposerEmail: `integrated-proposer-${randomUUID()}@example.test`,
    firstName: "Integrated",
    lastName: "Proposer",
    title,
    abstract:
      "A synthetic discussion of canonical publication, accountable participation and preserved evidence across an integrated conference rehearsal.",
  });
  // The verified proposer already agreed to speaker terms at submission; invite a distinct person for confirmation.
  const since = await capturedEmailCount();
  const invitation = await speaker.request.post(`/api/v1/proposals/access/${proposal.accessToken}/speakers`, {
    data: coSpeakerInviteSchema.parse({ email, firstName: "Integrated", lastName: "Speaker", role: "speaker" }),
  });
  expect(invitation.status(), await invitation.text()).toBe(200);
  expect(coSpeakerInviteResponseSchema.parse(await invitation.json()).email).toBe(email);
  const message = await waitForCapturedEmail(email, "You have been added as a speaker", { since });
  const speakerUrl = extractEmailUrl(message, "/speaker/");
  const token = new URL(speakerUrl).searchParams.get("token");
  if (!token) throw new Error("The speaker must use their own emailed capability");
  let path = `/api/v1/proposals/speakers/access/${encodeURIComponent(token)}`;
  await speaker.goto(speakerUrl);
  const before = speakerSelfServiceReadResponseSchema.parse(await (await speaker.request.get(path)).json());
  expect(before.speaker.status).toBe("invited");
  expect(before.profile.actingIdentitySelection).toBe("unrecorded");
  expect(before.currentRepresentation).toBeNull();
  expect(before.profile.email).toBe(email);
  await expect(speaker.getByRole("button", { name: "Confirm participation", exact: true })).toBeDisabled();
  await expect(speaker.locator("[data-speaker-consents]").getByRole("checkbox").first()).toBeVisible();
  await acceptVisibleTerms(speaker, "[data-speaker-consents]");
  await speaker
    .getByRole("radio", { name: "No — I am not employed by and do not own an organization", exact: true })
    .check();
  await speaker
    .getByRole("checkbox", {
      name: "I am not employed by, do not own, and am not authorized to represent an organization.",
      exact: true,
    })
    .check();
  await speaker
    .locator("[data-speaker-identity]")
    .getByRole("textbox", { name: "Your email address", exact: true })
    .fill(email);
  const proofSince = await capturedEmailCount();
  await speaker.getByRole("button", { name: "Verify my email", exact: true }).click();
  const proofMail = await waitForCapturedEmail(email, "Verify your email for", { since: proofSince });
  await speaker.goto(extractEmailUrl(proofMail, "/propose/"));
  await expect(speaker.locator("[data-consents]").getByRole("checkbox").first()).toBeVisible();
  await acceptVisibleTerms(speaker, "[data-consents]");
  await speaker.getByRole("button", { name: "Continue →", exact: true }).click();
  await expect(speaker.getByRole("button", { name: "Save profile", exact: true })).toBeVisible();
  const returnedToken = new URL(speaker.url()).searchParams.get("token");
  if (!returnedToken) throw new Error("Verified invitation must resume its own speaker capability");
  path = `/api/v1/proposals/speakers/access/${encodeURIComponent(returnedToken)}`;
  const verifying = speaker.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/v1/events/${sponsorEventSlug}/proposals/proof/verify` &&
      response.request().method() === "POST",
  );
  await acceptVisibleTerms(speaker, "[data-speaker-consents]");
  const verified = await verifying;
  expect(verified.status(), await verified.text()).toBe(200);
  expect(eventProposalProofVerifyResponseSchema.parse(await verified.json())).toMatchObject({
    status: "ready",
    email,
    applicantKind: "individual",
  });
  await speaker
    .getByRole("textbox", { name: "Biography", exact: true })
    .fill("An invited synthetic speaker reviewing the integrated publication and participation rehearsal.");
  const saving = speaker.waitForResponse(
    (response) => new URL(response.url()).pathname === `${path}/profile` && response.request().method() === "PATCH",
  );
  await speaker.getByRole("button", { name: "Save profile", exact: true }).click();
  const saved = await saving;
  expect(saved.status(), await saved.text()).toBe(200);
  expect(speakerSelfProfilePatchSchema.parse(saved.request().postDataJSON())).toMatchObject({
    actingIdentityId: null,
    unaffiliatedAttestation: true,
  });
  const selected = speakerProfileUpdateResponseSchema.parse(await saved.json());
  expect(selected.currentRepresentation?.actingIdentitySelection).toBe("individual");
  expect(selected.currentRepresentation?.email).toBe(email);
  await expect(speaker.getByRole("button", { name: "Confirm participation", exact: true })).toBeEnabled();
  await confirmSpeakerWithReceipt(speaker, path);
  const after = speakerSelfServiceReadResponseSchema.parse(await (await speaker.request.get(path)).json());
  expect(after.speaker.status).toBe("confirmed");
  expect(after.speaker.userId).toBe(before.speaker.userId);
  expect(after.currentRepresentation).toEqual(selected.currentRepresentation);
  await capturePilot(speaker, info, "pilot-confirmed-speaker");
  expect(await decideProposal(staff, proposal.proposalId, "accepted")).toBe(200);
  if (!after.speaker.userId) throw new Error("The confirmed speaker needs a canonical person");
  return { ...proposal, userId: after.speaker.userId, title, email, path };
}

export async function preparePilotConference(staff: Page, speaker: Awaited<ReturnType<typeof preparePilotSpeaker>>) {
  let snapshot = await readPilotAgenda(staff);
  expect(snapshot.occurrences, "Run the integrated pilot alone on fresh prepared state").toHaveLength(0);
  const rooms: string[] = [];
  for (const name of ["Pilot main room", "Pilot parallel room"]) {
    const response = await staff.request.post(`${pilotAgendaApi}/rooms`, {
      data: agendaRoomCreateSchema.parse({ expectedRevision: snapshot.revision, name, capacity: 100 }),
    });
    expect(response.status(), await response.text()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await response.json());
    const room = snapshot.rooms.find((row) => row.name === name);
    if (!room) throw new Error("Canonical room creation omitted the requested room");
    rooms.push(room.id);
  }
  const startAt = dateTimeLocalToIso("2026-12-01T09:00", snapshot.timeZone);
  const endAt = dateTimeLocalToIso("2026-12-01T10:00", snapshot.timeZone);
  const request = agendaImportSchema.parse({
    expectedRevision: snapshot.revision,
    source: "accepted_proposals",
    proposalIds: [speaker.proposalId],
    proposalPlacement: { proposalId: speaker.proposalId, startAt, endAt, roomId: rooms[0] },
    dryRun: true,
  });
  const review = await staff.request.post(`${pilotAgendaApi}/imports`, { data: request });
  expect(review.status(), await review.text()).toBe(200);
  const reviewed = agendaImportResponseSchema.parse(await review.json());
  expect(reviewed.dryRun).toBe(true);
  expect((await readPilotAgenda(staff)).occurrences).toHaveLength(0);
  expect(reviewed.placementFingerprint).toBeTruthy();
  const applied = await staff.request.post(`${pilotAgendaApi}/imports`, {
    data: agendaImportSchema.parse({
      ...request,
      dryRun: false,
      expectedPlacementFingerprint: reviewed.placementFingerprint,
    }),
  });
  expect(applied.status(), await applied.text()).toBe(200);
  const imported = agendaImportResponseSchema.parse(await applied.json());
  expect(imported.imported).toBe(1);
  const source = imported.agenda.occurrences.find((row) => row.title === speaker.title);
  if (!source) throw new Error("The accepted speaker proposal was not imported");
  expect(source.contentId).toBeTruthy();
  expect(
    source.history?.proposalRepresentations.some(
      (row) => row.userId === speaker.userId && row.selectedAt !== null && row.snapshot !== null,
    ),
  ).toBe(true);
  expect(source.speakers.map((row) => row.userId)).toContain(speaker.userId);
  const changed = await staff.request.patch(`${pilotAgendaApi}/occurrences/${source.id}`, {
    data: agendaOccurrencePatchSchema.parse({
      expectedRevision: imported.agenda.revision,
      admissionPolicy: "reservation",
    }),
  });
  expect(changed.status()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await changed.json());
  for (const [title, day, roomId] of [
    [`Pilot parallel ${randomUUID()}`, "2026-12-01", rooms[1]],
    [`Pilot day two ${randomUUID()}`, "2026-12-02", rooms[0]],
  ] as const) {
    const response = await staff.request.post(`${pilotAgendaApi}/occurrences`, {
      data: agendaOccurrenceCreateSchema.parse({
        expectedRevision: snapshot.revision,
        title,
        description: "A synthetic conference session retained through the integrated pilot.",
        startAt: dateTimeLocalToIso(`${day}T09:00`, snapshot.timeZone),
        endAt: dateTimeLocalToIso(`${day}T10:00`, snapshot.timeZone),
        roomId,
        admissionPolicy: "preference",
      }),
    });
    expect(response.status()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await response.json());
  }
  expect(snapshot.occurrences).toHaveLength(3);
  const parallel = snapshot.occurrences.find((row) => row.id !== source.id && row.startAt === source.startAt);
  if (!parallel) throw new Error("The pilot needs two independently scheduled parallel rooms");
  expect(parallel.roomId).not.toBe(source.roomId);
  return { sourceId: source.id, parallelId: parallel.id, roomIds: rooms };
}

export async function editAndSwapPilot(staff: Page, first: AgendaOccurrence, second: AgendaOccurrence, info: TestInfo) {
  await staff.goto(pilotAgendaPage);
  await staff.getByRole("tab", { name: "All sessions", exact: true }).click();
  await runRowAction(staff, staff.getByRole("row").filter({ hasText: first.title }), "Edit / move session");
  await staff
    .getByLabel("Description", { exact: true })
    .fill("Edited synthetic abstract carried into the same approved session.");
  await staff.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(staff.getByRole("button", { name: "Save session", exact: true })).toHaveCount(0);
  await staff.getByRole("tab", { name: "All sessions", exact: true }).click();
  await runRowAction(staff, staff.getByRole("row").filter({ hasText: first.title }), "Swap sessions");
  await staff.getByLabel(fieldLabel("Swap with session")).selectOption(second.id);
  await staff.getByRole("button", { name: "Review swap", exact: true }).click();
  await staff.getByRole("button", { name: "Apply reviewed schedule", exact: true }).click();
  await expect(staff.getByRole("button", { name: "Apply reviewed schedule", exact: true })).toHaveCount(0);
  const after = await readPilotAgenda(staff);
  const moved = after.occurrences.find((row) => row.id === first.id)!;
  const exchanged = after.occurrences.find((row) => row.id === second.id)!;
  expect(moved).toMatchObject({ roomId: second.roomId, startAt: second.startAt, contentId: first.contentId });
  expect(exchanged).toMatchObject({ roomId: first.roomId, startAt: first.startAt });
  expect(moved.speakers.map((row) => row.userId)).toEqual(first.speakers.map((row) => row.userId));
  expect(Date.parse(moved.endAt!) - Date.parse(moved.startAt!)).toBe(
    Date.parse(first.endAt!) - Date.parse(first.startAt!),
  );
  await capturePilot(staff, info, "pilot-edited-swapped-agenda");
}

export async function staffPilot(staff: Page, seniorUserId: string, info: TestInfo) {
  const roster = [{ id: seniorUserId, name: "Pilot senior" }];
  for (const name of ["Pilot junior one", "Pilot junior two"]) {
    const created = await staff.request.post("/api/v1/users", {
      data: userCreateSchema.parse({
        email: `pilot-staff-${randomUUID()}@example.test`,
        firstName: name,
        lastName: "Fixture",
      }),
    });
    expect(created.status()).toBe(201);
    roster.push({ id: userCreateResponseSchema.parse(await created.json()).userId, name });
  }
  const permissions = async () =>
    Promise.all(
      roster.map(
        async (person) =>
          userRolesListResponseSchema.parse(await (await staff.request.get(`/api/v1/users/${person.id}/roles`)).json())
            .roles,
      ),
    );
  const beforeGrants = await permissions();
  const snapshot = await readPilotAgenda(staff);
  const prefix = randomUUID();
  const roles = [
    { id: `${prefix}-mc`, name: "Pilot MC", showOnAgenda: true },
    { id: `${prefix}-door`, name: "Pilot doors", showOnAgenda: false },
  ];
  const posts = ["Pilot north entrance", "Pilot south entrance"].map((name, index) => ({
    id: `${prefix}-post-${index}`,
    name,
    roomId: null,
  }));
  const blocks = ["2026-12-01", "2026-12-02"].map((day, index) => ({
    id: `${prefix}-block-${index}`,
    name: `Pilot day ${index + 1} opening`,
    startAt: dateTimeLocalToIso(`${day}T10:00`, snapshot.timeZone),
    endAt: dateTimeLocalToIso(`${day}T10:30`, snapshot.timeZone),
    roomId: null,
    roles: roles.map((role) => role.id),
    compatibleRolePairs: [],
    roleRequirements: [],
  }));
  const requirements = blocks.flatMap((block) => [
    {
      id: `${block.id}-mc`,
      blockId: block.id,
      roleId: roles[0]!.id,
      postId: null,
      idealCount: 1,
      seniority: "any",
      attendanceMode: "physical",
    },
    ...posts.map((post) => ({
      id: `${block.id}-${post.id}`,
      blockId: block.id,
      roleId: roles[1]!.id,
      postId: post.id,
      idealCount: 1,
      seniority: "any",
      attendanceMode: "physical",
    })),
  ]);
  const configured = await staff.request.post(`${pilotAgendaApi}/staffing`, {
    data: agendaStaffingSchema.parse({
      expectedRevision: snapshot.revision,
      blocks,
      staffingRoles: roles,
      staffingPosts: posts,
      staffingRequirements: requirements,
      staffingPositions: requirements.map((need) => ({ id: `${need.id}-position`, requirementId: need.id, index: 1 })),
      assignments: [],
      roleMembers: roster.map((person, index) => ({
        userId: person.id,
        displayName: person.name,
        roles: roles.map((role) => role.id),
        seniority: index === 0 ? "senior" : "junior",
        attendanceMode: "physical",
        availableFrom: null,
        availableUntil: null,
        maxMinutes: null,
      })),
    }),
  });
  expect(configured.status(), await configured.text()).toBe(200);
  await staff.goto(pilotAgendaPage);
  await staff.getByRole("tab", { name: "Block roles", exact: true }).click();
  for (const [menu, action] of [
    ["Pilot day 1 opening", "Review staffing"],
    ["Pilot MC · Event", "Review positions"],
    ["Position 1", "Edit assignment"],
  ]) {
    await staff.getByRole("button", { name: `Actions for ${menu}`, exact: true }).click();
    await staff.getByRole("menuitem", { name: action, exact: true }).click();
  }
  await staff.getByLabel("Assigned person", { exact: true }).selectOption(seniorUserId);
  await staff.getByRole("checkbox", { name: "Pin assignment during rotation", exact: true }).check();
  await staff.getByRole("button", { name: "Save assignment", exact: true }).click();
  await expect(staff.getByRole("button", { name: "Save assignment", exact: true })).toHaveCount(0);
  const pinned = (await readPilotAgenda(staff)).assignments.find((row) => row.pinned)!;
  expect(pinned.userId).toBe(seniorUserId);
  await staff.getByRole("button", { name: "Actions for Event staffing", exact: true }).click();
  await staff.getByRole("menuitem", { name: "Configure rotation", exact: true }).click();
  await staff.getByLabel("Rotation seed", { exact: true }).fill("integrated-pilot-fair-rotation");
  await staff.getByRole("button", { name: "Generate assignments", exact: true }).click();
  await expect(staff.getByText("Assignments generated.", { exact: false })).toBeVisible();
  const generated = await readPilotAgenda(staff);
  expect(generated.assignments).toContainEqual(pinned);
  expect(generated.staffingReport?.coverage).toHaveLength(6);
  expect(generated.staffingReport?.uncovered).toHaveLength(0);
  const workloads = generated.staffingReport!.people.map((person) => person.minutes);
  expect(Math.max(...workloads) - Math.min(...workloads)).toBeLessThanOrEqual(30);
  expect(await permissions()).toEqual(beforeGrants);
  await capturePilot(staff, info, "pilot-pinned-fair-staffing");
  return { pinned, userIds: roster.map((person) => person.id) };
}

export async function grantPilotDoor(staff: Page, userId: string, eventId: string) {
  const ids: string[] = [];
  for (const permission of ["agenda:check", "agenda:admit", "agenda:attendance_record"] as const) {
    const response = await staff.request.post("/api/v1/permissions/grants", {
      data: accessGrantCreateSchema.parse({ userId, permission, contextType: "event", contextId: eventId }),
    });
    expect(response.status()).toBe(201);
    ids.push(accessGrantCreateResponseSchema.parse(await response.json()).grant.id);
  }
  return ids;
}

export async function releasePilotArchive(staff: Page, occurrence: AgendaOccurrence, info: TestInfo) {
  await staff.goto(pilotAgendaPage);
  await staff.getByRole("tab", { name: "All sessions", exact: true }).click();
  await runRowAction(
    staff,
    staff.getByRole("row").filter({ hasText: occurrence.title }),
    "Session archive / materials",
  );
  await staff.getByRole("button", { name: "Add material release", exact: true }).click();
  const title = "Synthetic pilot reviewed recording";
  await staff
    .getByRole("group", { name: "New material", exact: true })
    .getByLabel("Material title", { exact: true })
    .fill(title);
  const fields = staff.getByRole("group", { name: title, exact: true });
  const url = "https://www.youtube.com/watch?v=AbCdEf12345&start=90";
  await fields.getByLabel("Material type", { exact: true }).selectOption("recording");
  await fields.getByLabel("Public delivery URL", { exact: true }).fill(url);
  for (const name of ["Rights confirmed", "Speaker consent confirmed", "File and accessibility reviewed"])
    await fields.getByLabel(name, { exact: true }).check();
  await fields.getByLabel("Release status", { exact: true }).selectOption("approved");
  const path = `${pilotAgendaApi}/occurrences/${occurrence.id}/history`;
  const saving = staff.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === "POST",
  );
  await staff.getByRole("button", { name: "Save archive details", exact: true }).click();
  const saved = await saving;
  expect(saved.status(), await saved.text()).toBe(200);
  expect(sessionHistoryCorrectionSchema.parse(saved.request().postDataJSON()).history.materials).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        title,
        status: "approved",
        rightsConfirmed: true,
        consentConfirmed: true,
        validated: true,
      }),
    ]),
  );
  const current = (await readPilotAgenda(staff)).occurrences.find((row) => row.id === occurrence.id)!;
  expect(current.speakers.map((row) => row.userId)).toEqual(occurrence.speakers.map((row) => row.userId));
  await capturePilot(staff, info, "pilot-approved-archive-workflow");
  return { occurrence: current, title, url };
}

export async function approvePilotAppearance(staff: Page, occurrence: AgendaOccurrence, userId: string) {
  await staff.goto(pilotAgendaPage);
  await staff.getByRole("tab", { name: "All sessions", exact: true }).click();
  await runRowAction(
    staff,
    staff.getByRole("row").filter({ hasText: occurrence.title }),
    "Session archive / materials",
  );
  expect(occurrence.history?.proposalRepresentations.find((choice) => choice.userId === userId)).toMatchObject({
    actingIdentityId: null,
    snapshot: { organizationName: null, jobTitle: null },
  });
  for (const credit of occurrence.speakers) {
    const appearance = staff.getByRole("group", { name: credit.displayName, exact: true });
    await appearance
      .getByRole("combobox", { name: "Representation at this event", exact: true })
      .selectOption({ label: "Individual appearance" });
    await appearance
      .getByRole("button", { name: `Approve representation for ${credit.displayName}`, exact: true })
      .click();
    await expect(appearance.getByText("Representation approved", { exact: true })).toBeVisible();
  }
  await staff.getByRole("button", { name: "Save archive details", exact: true }).click();
  await expect(staff.getByRole("heading", { name: /^Session archive ·/ })).toHaveCount(0);
}
