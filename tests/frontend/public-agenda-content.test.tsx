// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStringAsync } from "preact-render-to-string";
import { agendaRows } from "../../assets/ts/site/agenda-layout";
import { applyApprovedAgenda } from "../../functions/_lib/services/site-approved-agenda";
import { publishedConferenceProgram } from "../../functions/_lib/services/site-conference-program";
import { conferenceAgendaCalendar } from "../../functions/_lib/services/site-conference-calendar";
import { publicAgendaProjection } from "../../functions/_lib/services/event-agenda/public-projection";
import { preparePublicAgendaSnapshot } from "../../functions/_lib/services/event-agenda/public-snapshot";
import { agendaContent } from "../../assets/shared/public-agenda-content";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { sessionHistoryStructuredData } from "../../functions/_lib/services/site-history-structured-data";
import { publishedSessionHistory, publishedSpeakerHistory } from "../../functions/_lib/services/site-session-history";
import fixture from "../fixtures/site-publication.json";
import { sessionPresentationPublicUrl } from "../../assets/shared/session-presentation-public-url";
import {
  approvedAgendaInstant as instant,
  approvedAgendaSnapshot as snapshot,
  approvedAgendaPublication as publication,
} from "../fixtures/approved-agenda";

describe("shared public agenda content", () => {
  it.each([false, true])(
    "keeps a linked person's profile candidate private and respects approved appearance=%s",
    (approved) => {
      const source = structuredClone(snapshot);
      const occurrence = source.occurrences[0]!;
      if (!approved) occurrence.history!.appearances = [];
      occurrence.history!.proposalRepresentations = [];
      const parsed = agendaSnapshotSchema.parse({
        ...source,
        occurrences: [
          {
            ...occurrence,
            speakers: occurrence.speakers.map((speaker) => ({
              ...speaker,
              profileCandidate: { biography: "Current intrinsic profile biography", photoUrl: "/candidate-photo.jpg" },
            })),
          },
        ],
      });
      const before = structuredClone(parsed);
      const organizer = agendaContent(parsed, true).days[0]!.slots[0]!.sessions[0]!.speakers[0]!;
      expect(organizer.bioMarkdown).toBe(
        approved ? occurrence.history!.appearances[0].biography : "Current intrinsic profile biography",
      );
      expect(organizer.imageSrc).toBe(approved ? "/approved-photo.jpg" : "/candidate-photo.jpg");
      expect(organizer.title).toBe(approved ? "Engineer at Historical organization" : "");
      const publicProjection = publicAgendaProjection(parsed, null);
      expect(JSON.stringify(publicProjection)).not.toContain("profileCandidate");
      for (const publicSource of [parsed, publicProjection]) {
        const credit = agendaContent(publicSource).days[0]!.slots[0]!.sessions[0]!.speakers[0]!;
        expect(credit.bioMarkdown).toBe(approved ? occurrence.history!.appearances[0].biography : undefined);
        expect(credit.imageSrc).toBe(approved ? "/approved-photo.jpg" : undefined);
        expect(JSON.stringify(credit)).not.toContain("Current intrinsic");
        expect(JSON.stringify(credit)).not.toContain("candidate-photo");
      }
      expect(parsed).toEqual(before);
    },
  );

  it.each(["missing", "draft", "withdrawn", "failed", "rights", "consent", "validation", "approval"])(
    "keeps raw slide/recording candidates private when material release is %s",
    (condition) => {
      const source = structuredClone(snapshot);
      const occurrence = source.occurrences[0]!;
      occurrence.presentationUrl = "/candidate-only.pdf";
      occurrence.recordingUrl = "https://example.test/candidate-only";
      if (condition === "missing") occurrence.history = undefined;
      else {
        const material = occurrence.history!.materials[0]!;
        if (["draft", "withdrawn", "failed"].includes(condition))
          material.status = condition as "draft" | "withdrawn" | "failed";
        if (condition === "rights") material.rightsConfirmed = false;
        if (condition === "consent") material.consentConfirmed = false;
        if (condition === "validation") material.validated = false;
        if (condition === "approval") material.approvedAt = null;
      }
      for (const publicCopy of [
        preparePublicAgendaSnapshot(source, 4, instant),
        publicAgendaProjection(source, null),
      ]) {
        expect(publicCopy.occurrences[0]!.presentationUrl).toBeNull();
        expect(publicCopy.occurrences[0]!.recordingUrl).toBeNull();
      }
      const session = agendaContent(source).days[0]!.slots[0]!.sessions[0]!;
      expect(session.presentationUrl).toBeUndefined();
      expect(session.recordingUrl).toBeUndefined();
      expect(agendaContent(source, true).days[0]!.slots[0]!.sessions[0]).toMatchObject({
        presentationUrl: occurrence.presentationUrl,
        recordingUrl: occurrence.recordingUrl,
      });
      expect(occurrence.recordingUrl).toBe("https://example.test/candidate-only");
    },
  );
  it("discovers recording, caption and transcript releases at the same occurrence archive route", () => {
    const source = structuredClone(snapshot);
    const occurrence = source.occurrences[0]!;
    const originalRoute = publishedSessionHistory(publication)[0]!.route;
    occurrence.history!.materials = ["recording", "captions", "transcript"].map((kind) => ({
      ...occurrence.history!.materials[0]!,
      kind: kind as "recording" | "captions" | "transcript",
      id: kind,
      title: `Reviewed ${kind}`,
      url: kind === "recording" ? "https://www.youtube.com/watch?v=AbCdEf12345&start=90" : `/materials/${kind}.v1`,
    }));
    const updated = sitePublicationSnapshotSchema.parse({
      ...publication,
      eventAgendas: { [source.eventSlug]: source },
    });
    const archive = publishedSessionHistory(updated)[0]!;
    expect(archive.route).toBe(originalRoute);
    expect(archive.materials.map((material) => material.kind)).toEqual(["recording", "captions", "transcript"]);
    expect(agendaContent(source).days[0]!.slots[0]!.sessions[0]!.recordingUrl).toContain("&start=90");
    expect(publishedSessionHistory(publication)[0]!.materials.map((material) => material.kind)).toEqual([
      "presentation",
    ]);
  });
  it.each(["selected", "unselected", "missing receipt", "withdrawn", "organizer", "source only"])(
    "uses historical PDF receipt selection with %s material",
    (scenario) => {
      const oldUrl = "/events/approved-event/slides%20one.pdf";
      const sourceUrl = "/content-media/events/approved-event/slides%20one.pdf";
      const canonicalUrl = sessionPresentationPublicUrl({
        eventSlug: snapshot.eventSlug,
        occurrenceId: "10000000-0000-4000-8000-000000000001",
        versionId: "10000000-0000-4000-8000-000000000002",
        digest: "b".repeat(64),
      });
      const source = structuredClone(snapshot);
      const history = source.occurrences[0]!.history!;
      history.legacyDownloads = [
        {
          url: oldUrl,
          targetUrl: sourceUrl,
          sourcePath: "event/index.md",
          sourceDigest: "a".repeat(64),
          sourceLocator: "agenda:1",
          pdfDigest: "b".repeat(64),
          pdfBytes: 100,
        },
      ];
      const material = history.materials[0]!;
      material.url = scenario === "source only" ? sourceUrl : canonicalUrl;
      material.presentationSource = "session";
      material.presentationVersionId = scenario === "source only" ? null : "10000000-0000-4000-8000-000000000002";
      material.legacyDownloadUrl = scenario === "unselected" || scenario === "source only" ? null : oldUrl;
      if (scenario === "missing receipt") history.legacyDownloads = [];
      if (scenario === "withdrawn") material.status = "withdrawn";
      const parsed = agendaSnapshotSchema.parse(source);
      const before = structuredClone(parsed.occurrences[0]!.history);
      const session = agendaContent(parsed, scenario === "organizer").days[0]!.slots[0]!.sessions[0]!;
      expect(session.legacyPresentationUrl).toBe(
        scenario === "selected" || scenario === "source only" ? oldUrl : undefined,
      );
      if (scenario !== "withdrawn")
        expect(session.presentationUrl).toBe(scenario === "source only" ? sourceUrl : canonicalUrl);
      expect(parsed.occurrences[0]!.history).toEqual(before);
    },
  );
  it.each(["moved", null])(
    "renders a historical alias with placement %s on its owning session without rewriting its receipt",
    async (placement) => {
      const originalRoom = crypto.randomUUID();
      const source = agendaSnapshotSchema.parse({
        ...snapshot,
        rooms: [
          ...snapshot.rooms.map((room) => ({ ...room, id: originalRoom })),
          { id: "moved", name: "Moved room", capacity: 100 },
        ],
        occurrences: [
          {
            ...snapshot.occurrences[0],
            roomId: placement,
            history: {
              ...snapshot.occurrences[0]!.history,
              legacyFragments: [
                {
                  anchor: "sessionModal-1000-0-original/title",
                  kind: "dialog",
                  roomRef: "Original authored room",
                  roomId: originalRoom,
                  sourcePath: "/events/original/",
                  sourceDigest: "a".repeat(64),
                  sourceLocator: "original-row",
                  authoredDate: "2026-12-01",
                  authoredStart: "10:00",
                  authoredTitle: "Original/title",
                },
              ],
            },
          },
          {
            ...snapshot.occurrences[0],
            id: "unrelated",
            roomId: originalRoom,
            title: "Another session",
            history: undefined,
          },
        ],
      });
      const original = structuredClone(source.occurrences[0]!.history!.legacyFragments);
      const content = agendaContent(publicAgendaProjection(source, null));
      const host = document.createElement("div");
      host.innerHTML = await renderToStringAsync(
        <ContentAgenda days={content.days} speakers={content.speakers} timeZone={source.timeZone} />,
      );
      const alias = [...host.querySelectorAll<HTMLElement>("[id]")].find((node) => node.id === original[0]!.anchor)!;
      expect(alias).toBeDefined();
      expect(alias.closest("td")?.getAttribute("data-agenda-cell")).toBe(placement ?? originalRoom);
      const article = alias.closest("article")!;
      expect(article.getAttribute("data-agenda-occurrence")).toBe("session");
      expect(article.getAttribute("data-agenda-session")).toBe(placement ?? "");
      expect(content.days[0]!.slots[0]!.sessions[0]!.locations).toEqual(placement ? [placement] : []);
      // An unplaced card has no room label at all rather than an empty one.
      if (placement === null) expect(article.querySelector(".pk-content-agenda__room")).toBeNull();
      const target = [...host.querySelectorAll("dialog")].find(
        (dialog) => dialog.id === alias.dataset.agendaFragmentDialog,
      );
      // The speaker's session list may name the other session; the dialog itself belongs to its owner.
      expect(target?.querySelector(".session-modal__title")?.textContent).toBe("Approved session");
      expect(target?.closest("article")?.getAttribute("data-agenda-occurrence")).toBe("session");
      expect(source.occurrences[0]!.history!.legacyFragments).toEqual(original);
    },
  );
  it("uses frozen speaker credits in cards and gallery, approved media and actual archive URLs", () => {
    const content = agendaContent(snapshot);
    expect(content.speakers).toEqual([
      {
        name: "Historical speaker",
        title: "Engineer at Historical organization",
        bioMarkdown: "**Approved biography** <script>unsafe()</script>",
        imageSrc: "/approved-photo.jpg",
        organization: { name: "Historical organization" },
        moderator: true,
        speakerKey: "user:person",
        personPath: "/people/person/",
      },
    ]);
    const session = content.days[0]!.slots[0]!.sessions[0]!;
    expect(session.speakers).toEqual(content.speakers);
    expect(session.sessionUrl).toBe(publishedSessionHistory(publication)[0]!.route);
    expect(session.presentationUrl).toBe("/approved-slides.pdf");
    expect(session.recordingUrl).toBeUndefined();
  });

  it.each(["recorded", "unselected", "approved"])(
    "uses %s proposal representation only within the appropriate draft display boundary",
    (state) => {
      const source = structuredClone(snapshot);
      const occurrence = source.occurrences[0]!;
      if (state !== "approved") occurrence.history!.appearances = [];
      occurrence.history!.proposalRepresentations = [
        {
          userId: "person",
          actingIdentityId: state === "unselected" ? null : crypto.randomUUID(),
          selectedAt: state === "unselected" ? null : instant,
          snapshot:
            state === "unselected"
              ? null
              : {
                  jobTitle: "Recorded proposal title",
                  organizationName: "Recorded proposal organization",
                  biography: null,
                  links: [],
                },
        },
      ];
      const parsed = agendaSnapshotSchema.parse(source);
      const before = structuredClone(parsed);
      const organizer = agendaContent(parsed, true);
      const organizerCredit = organizer.days[0]!.slots[0]!.sessions[0]!.speakers[0]!;
      expect(organizerCredit).toMatchObject({ moderator: true });
      expect(organizerCredit.title).toBe(
        state === "approved"
          ? "Engineer at Historical organization"
          : state === "recorded"
            ? "Recorded proposal title at Recorded proposal organization"
            : undefined,
      );
      expect(organizerCredit.name).toBe(state === "approved" ? "Historical speaker" : "Current profile name");
      expect(organizer.speakers).toEqual([organizerCredit]);
      for (const publicSource of [parsed, publicAgendaProjection(parsed, null)]) {
        const publicCredit = agendaContent(publicSource).days[0]!.slots[0]!.sessions[0]!.speakers[0]!;
        expect(publicCredit.title).toBe(state === "approved" ? "Engineer at Historical organization" : undefined);
        expect(JSON.stringify(publicCredit)).not.toContain("Recorded proposal");
      }
      expect(parsed).toEqual(before);
    },
  );

  it("keeps private scheduled cards in organizer mode but excludes them from public cards and gallery", () => {
    const privateOccurrence = {
      ...snapshot.occurrences[0]!,
      id: "private",
      title: "Private session",
      visibility: "private" as const,
      speakers: [{ userId: "private-person", displayName: "Private speaker", role: "speaker" as const }],
      history: undefined,
    };
    const source = { ...snapshot, occurrences: [...snapshot.occurrences, privateOccurrence] };
    expect(agendaContent(source).speakers.map((person) => person.name)).toEqual(["Historical speaker"]);
    expect(agendaContent(source, true).days[0]!.slots[0]!.sessions.map((session) => session.id)).toEqual([
      "session",
      "private",
    ]);
  });

  it("shows only agenda-visible duties publicly while organizer mode retains operational roles", () => {
    const source = agendaSnapshotSchema.parse({
      ...snapshot,
      staffingRoles: [
        { id: "mc", name: "MC", showOnAgenda: true },
        { id: "scan", name: "Badge scanning", showOnAgenda: false },
      ],
      shifts: [
        {
          id: "block",
          name: "Morning",
          startAt: instant,
          endAt: "2026-12-01T10:00:00.000Z",
          roomId: "hall",
          roles: ["mc", "scan"],
        },
      ],
      roleMembers: [
        {
          userId: "staff",
          displayName: "Duty holder",
          roles: ["mc", "scan"],
          availableFrom: null,
          availableUntil: null,
          maxMinutes: null,
        },
      ],
      assignments: ["mc", "scan"].map((role) => ({
        positionId: role,
        shiftId: "block",
        role,
        postId: null,
        userId: "staff",
        pinned: false,
      })),
    });
    expect(agendaContent(source).days[0]!.staffing![0]!.duties.map((duty) => duty.role)).toEqual(["MC"]);
    expect(agendaContent(source, true).days[0]!.staffing![0]!.duties.map((duty) => duty.role)).toEqual([
      "MC",
      "Badge scanning",
    ]);
  });

  it("preserves source-only credits without manufactured profiles or name-based merging", () => {
    const source = agendaSnapshotSchema.parse({
      ...snapshot,
      occurrences: [
        {
          ...snapshot.occurrences[0],
          speakers: [
            ...snapshot.occurrences[0]!.speakers,
            { userId: "additional", displayName: "Additional linked speaker", role: "speaker" },
          ],
          history: {
            ...snapshot.occurrences[0]!.history,
            archivalCredits: [
              {
                sourceRef: "archived/speaker",
                role: "moderator",
                sourcePath: "content/events/old/speakers.yaml",
                sourceDigest: "a".repeat(64),
                provenance: "authored_public",
                displayName: "Historical speaker",
                jobTitle: "Source title",
                organizationName: "Source organization",
                biography: "Preserved source biography",
                photoUrl: "/source-photo.jpg",
              },
            ],
          },
        },
      ],
    });
    const frozenBefore = JSON.stringify(source);
    const content = agendaContent(source);
    expect(content.speakers.map((credit) => credit.name)).toEqual([
      "Historical speaker",
      "Additional linked speaker",
      "Historical speaker",
    ]);
    expect(content.speakers[2]).toMatchObject({
      title: "Source title at Source organization",
      bioMarkdown: "Preserved source biography",
      imageSrc: "/source-photo.jpg",
      moderator: true,
    });
    const program = applyApprovedAgenda(
      publishedConferenceProgram({ name: "Archive", timezone: source.timeZone, agenda: {} }, () => []),
      source,
    );
    expect(program.agenda["2026-12-01"]![0]!.sessions[0]!.speakers).toEqual([
      "Historical speaker *",
      "Additional linked speaker",
      "Historical speaker *",
    ]);
    const published = sitePublicationSnapshotSchema.parse({ ...fixture, eventAgendas: { "approved-event": source } });
    const archive = publishedSessionHistory(published)[0]!;
    const graph = sessionHistoryStructuredData(archive, "https://pkic.org");
    const event = graph["@graph"][0]!;
    const performers = "performer" in event ? event.performer : undefined;
    expect(performers).toEqual([
      { "@type": "Person", name: "Historical speaker", url: "https://pkic.org/people/person/" },
      { "@type": "Person", name: "Additional linked speaker", url: "https://pkic.org/people/additional/" },
      { "@type": "Person", name: "Historical speaker" },
    ]);
    expect(
      publishedSpeakerHistory(published)
        .map((person) => person.userId)
        .sort(),
    ).toEqual(["additional", "person"]);
    expect(JSON.stringify(source)).toBe(frozenBefore);
  });

  it("renders an explicit source panelist role without inferring identity from the display name", async () => {
    const source = agendaSnapshotSchema.parse({
      ...snapshot,
      occurrences: [
        {
          ...snapshot.occurrences[0],
          speakers: [],
          history: {
            ...snapshot.occurrences[0]!.history,
            appearances: [],
            archivalCredits: [
              {
                sourceRef: "source/panelist",
                sourcePath: "data/speakers.yaml",
                sourceDigest: "c".repeat(64),
                provenance: "authored_public",
                role: "panelist",
                displayName: "Unlinked panelist",
                jobTitle: null,
                organizationName: null,
                biography: "",
                photoUrl: null,
              },
            ],
          },
        },
      ],
    });
    const content = agendaContent(source);
    expect(content.speakers[0]).toMatchObject({ name: "Unlinked panelist", roleLabel: "Panelist", moderator: false });
    const output = await renderToStringAsync(
      <ContentAgenda days={content.days} speakers={content.speakers} timeZone={source.timeZone} />,
    );
    expect(output).toContain("Panelist");
    expect(output).not.toContain("/people/");
  });

  it("publishes an archival start with an explicitly unknown end, without booking or fabricated duration", async () => {
    const source = agendaSnapshotSchema.parse({
      ...snapshot,
      occurrences: [
        {
          ...snapshot.occurrences[0],
          title: "Networking",
          startAt: null,
          endAt: null,
          history: {
            ...snapshot.occurrences[0]!.history,
            archivalTiming: {
              sourcePath: "data/events/old/agenda.yaml",
              sourceDigest: "b".repeat(64),
              provenance: "authored_public",
              timeZone: "Europe/Amsterdam",
              authoredDate: "2023-06-06",
              authoredStart: "15:30",
              startAt: "2023-06-06T13:30:00.000Z",
              endAt: null,
            },
          },
        },
      ],
    });
    const publicSnapshot = publicAgendaProjection(preparePublicAgendaSnapshot(source, 4, instant), null);
    expect(publicSnapshot.occurrences).toHaveLength(1);
    const content = agendaContent(publicSnapshot);
    const session = content.days[0]!.slots[0]!.sessions[0]!;
    expect(content.days[0]!.date).toBe("2023-06-06");
    expect(content.days[0]!.slots[0]!.time).toBe("15:30");
    expect(session).toMatchObject({ endNotRecorded: true });
    expect(session.endsAt).toBeUndefined();
    expect(session.durationMinutes).toBeUndefined();
    expect(session.participation).toBeUndefined();
    const html = await renderToStringAsync(
      <ContentAgenda days={content.days} speakers={content.speakers} timeZone={source.timeZone} />,
    );
    expect(html).toContain("End not recorded");
    expect(html).not.toContain("30 min");
    const row = agendaRows(content.days[0]!)[0]!;
    expect(row.cells[0]!.rowSpan).toBe(1);
    const program = applyApprovedAgenda(
      publishedConferenceProgram({ name: "Archive", timezone: source.timeZone, agenda: {} }, () => []),
      publicSnapshot,
    );
    const calendar = conferenceAgendaCalendar(program, "https://pkic.org/events/archive/", instant);
    expect(calendar).toContain("DTSTART:20230606T133000Z");
    expect(calendar).toContain("SUMMARY:Networking");
    expect(calendar).toContain("End not recorded");
    expect(calendar).not.toContain("DTEND");
    expect(calendar).not.toContain("DURATION");
    expect(source.occurrences[0]).toMatchObject({ startAt: null, endAt: null });
  });

  it("keeps the closing time marker without inventing an empty break card", async () => {
    const content = agendaContent(snapshot);
    const output = await renderToStringAsync(
      <ContentAgenda days={content.days} speakers={content.speakers} timeZone={snapshot.timeZone} />,
    );
    expect(output).toContain("2026-12-01T10:00:00.000Z");
    expect(output).not.toContain('class="pk-content-agenda__break"');
    const day = {
      ...content.days[0]!,
      slots: [{ ...content.days[0]!.slots[1]!, title: "Coffee break", durationMinutes: 20 }],
    };
    const titled = await renderToStringAsync(<ContentAgenda days={[day]} speakers={[]} timeZone={snapshot.timeZone} />);
    expect(titled).toContain('class="pk-content-agenda__break"');
    expect(titled).toContain("Coffee break");
  });

  it("does not offer a nonexistent session archive for a short announcement", () => {
    const source = { ...snapshot, occurrences: [{ ...snapshot.occurrences[0]!, description: "Brief update" }] };
    expect(agendaContent(source).days[0]!.slots[0]!.sessions[0]!.sessionUrl).toBeUndefined();
  });
});
