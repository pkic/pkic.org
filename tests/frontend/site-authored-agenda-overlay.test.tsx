// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderContentAgenda } from "../../functions/_lib/services/site-agenda";
import { approvedAgendaSnapshot, approvedAgendaPublication } from "../fixtures/approved-agenda";

describe("original authored event-root agenda overlay", () => {
  it("renders the approved canonical cards and retained anchors without rendering ownership evidence", async () => {
    const agenda = structuredClone(approvedAgendaSnapshot);
    agenda.occurrences[0]!.publicAnchor = "approved-native-anchor";
    agenda.occurrences[0]!.history!.legacyFragments.push({
      anchor: "original-authored-anchor",
      kind: "dialog",
      roomRef: "Main hall",
      roomId: "hall",
      sourcePath: "content/events/2023/original/index.md",
      sourceDigest: "a".repeat(64),
      sourceLocator: "talk",
      authoredDate: "2026-12-01",
      authoredStart: "10:00",
      authoredTitle: agenda.occurrences[0]!.title,
    });
    const originalRoute = "/events/2023/original/";
    const publication = {
      ...approvedAgendaPublication,
      eventAgendas: { [agenda.eventSlug]: agenda },
      authoredAgendaRoutes: [
        {
          eventSlug: agenda.eventSlug,
          sourcePath: "content/events/2023/original/index.md",
          sourceDigest: "a".repeat(64),
          route: originalRoute,
        },
      ],
    };
    const html = await renderContentAgenda(
      {
        publication,
        route: originalRoute,
        eventRoute: originalRoute,
        eventData: { agenda: {} },
        data: {},
        assetUrl: () => undefined,
        assetUrls: () => [],
        listing: () => ({ heading: "", kind: "events", items: [], page: 1, pageCount: 1 }),
        sourcePath: "content/events/2023/original/index.md",
      },
      async () => {
        throw new Error("Approved content must render its safe canonical Markdown");
      },
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const title = agenda.occurrences[0]!.title;
    expect(host.textContent).toContain(title);
    expect(host.querySelectorAll(".pk-content-agenda")).toHaveLength(1);
    expect(host.querySelector('[id="approved-native-anchor"]')).not.toBeNull();
    expect(host.querySelector('[id="original-authored-anchor"]')).not.toBeNull();
    expect(html).not.toContain("content/events/");
    expect(html).not.toContain("a".repeat(64));
  });
});
