// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderToStringAsync } from "preact-render-to-string";
import { agendaContent } from "../../assets/shared/public-agenda-content";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { sitePublicationSnapshotSchema } from "../../assets/shared/schemas/site-publication";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { renderContentAgenda } from "../../functions/_lib/services/site-agenda";
import {
  approvedAgendaInstant as instant,
  approvedAgendaSnapshot as snapshot,
  approvedAgendaPublication as publication,
} from "../fixtures/approved-agenda";

describe("approved static and portal agenda parity", () => {
  it.each(["baseline", "long panel, parallel rooms and repeated content"])(
    "renders identical static and portal content for %s without private profile fallback",
    async (scenario) => {
      const source = structuredClone(snapshot);
      const matrix = scenario !== "baseline";
      const session = source.occurrences[0]!;
      if (matrix) {
        session.contentId = "shared-panel-content";
        session.title =
          "A practical cryptographic transition panel: coordinating infrastructure, application teams, procurement, operational readiness, and standards through an extended program with several independent representations";
        session.description =
          "**Practical transition lessons**\n\n" +
          Array.from(
            { length: 8 },
            (_, index) =>
              `Discussion ${index + 1}: participants compare long-term cryptographic migration plans, operational safeguards, review decisions, and the evidence needed to maintain public trust.`,
          ).join("\n\n");
        session.additionalRoomIds = ["overflow"];
        source.rooms.push(
          { id: "overflow", name: "Overflow hall", capacity: 50, setupMinutes: 0 },
          { id: "parallel", name: "Parallel hall", capacity: 40, setupMinutes: 0 },
        );
        for (const [index, name] of [
          "Synthetic Panelist Alpha",
          "Synthetic Panelist Beta",
          "Synthetic Panelist Gamma",
        ].entries()) {
          const userId = `panelist-${index}`;
          session.speakers.push({ userId, displayName: `Unapproved roster ${index}`, role: "panelist" });
          session.history!.appearances.push({
            ...session.history!.appearances[0]!,
            userId,
            displayName: name,
            biography: `Approved biography for ${name}.`,
            photoUrl: index === 1 ? "/approved-panelist.jpg" : null,
          });
        }
        source.occurrences.push(
          {
            ...structuredClone(session),
            id: "parallel-session",
            contentId: "parallel-content",
            title: "Parallel session",
            roomId: "parallel",
            additionalRoomIds: [],
            speakers: [],
            history: undefined,
          },
          {
            ...structuredClone(session),
            id: "repeat",
            startAt: "2026-12-02T10:30:00.000Z",
            endAt: "2026-12-02T11:30:00.000Z",
            additionalRoomIds: [],
          },
          {
            ...structuredClone(session),
            id: "private-session",
            title: "Private session must remain isolated",
            visibility: "private",
            speakers: [{ userId: "private-person", displayName: "Private roster person" }],
            history: undefined,
          },
        );
      }
      const canonical = agendaSnapshotSchema.parse(source);
      const before = structuredClone(canonical);
      const published = sitePublicationSnapshotSchema.parse({
        ...publication,
        eventAgendas: { [canonical.eventSlug]: canonical },
      });
      const content = agendaContent(canonical);
      const portal = await renderToStringAsync(
        <ContentAgenda days={content.days} speakers={content.speakers} timeZone={canonical.timeZone} />,
      );
      const built = await renderContentAgenda(
        {
          assetUrl: () => undefined,
          assetUrls: () => [],
          data: {},
          eventSlug: canonical.eventSlug,
          eventData: { agenda: {}, speakers: [{ name: "Current profile name", bio: "Unapproved authored biography" }] },
          listing: () => {
            throw new Error("Unexpected listing lookup");
          },
          publication: published,
          route: "/events/approved-event/agenda/",
          sourcePath: "synthetic-event.md",
        },
        async () => {
          throw new Error("Approved content must use shared safe Markdown");
        },
      );
      const publicDocument = document.createElement("div");
      const previewDocument = document.createElement("div");
      publicDocument.innerHTML = built;
      previewDocument.innerHTML = portal;
      expect(publicDocument.querySelector(".pk-content-agenda")!.hasAttribute("data-agenda-public-fragments")).toBe(
        true,
      );
      expect(previewDocument.querySelector(".pk-content-agenda")!.hasAttribute("data-agenda-public-fragments")).toBe(
        false,
      );
      publicDocument.querySelector(".pk-content-agenda")!.removeAttribute("data-agenda-public-fragments");
      expect(publicDocument.innerHTML).toBe(previewDocument.innerHTML);
      expect(built).toContain("Historical speaker");
      expect(built).toContain("Historical organization");
      expect(built).not.toContain("Current profile name");
      expect(built).not.toContain("Unapproved authored biography");
      expect(built).not.toContain("Unapproved roster");
      expect(built).not.toContain("Private session must remain isolated");
      expect(built).not.toContain("Private roster person");
      expect(built).not.toContain("<script>");
      for (const document of [publicDocument, previewDocument]) {
        expect(document.querySelector("[data-agenda-session-controls]")).toBeNull();
        const cards = [...document.querySelectorAll<HTMLElement>("article[data-agenda-occurrence]")];
        expect(cards.map((card) => card.dataset.agendaOccurrence)).toEqual(
          matrix ? ["session", "parallel-session", "repeat"] : ["session"],
        );
        expect(cards.map((card) => card.closest("td")?.getAttribute("data-agenda-cell"))).toEqual(
          matrix ? ["hall", "parallel", "hall"] : ["hall"],
        );
        const targets = cards.map(
          (card) => card.querySelector<HTMLElement>("[data-agenda-open-session]")!.dataset.agendaOpenSession!,
        );
        expect(new Set(targets).size).toBe(cards.length);
        for (const [index, target] of targets.entries()) {
          const dialog = document.querySelector(`dialog[id="${target}"]`)!;
          expect(cards[index]!.contains(dialog)).toBe(true);
          expect(dialog.querySelector("h2")?.textContent).toBe(cards[index]!.querySelector("h3")?.textContent);
        }
        const clock = document.querySelector('[data-agenda-clock="venue"] time')!;
        expect(clock.getAttribute("datetime")).toBe(instant);
        expect(clock.textContent).toBe("10:00");
        expect(
          document.querySelector('.pk-content-agenda__time-heading small[title="Europe/Amsterdam"]')?.textContent,
        ).toBe("Time Amsterdam");
        const dayPanels = [...document.querySelectorAll<HTMLElement>(".pk-content-agenda__day")];
        expect(dayPanels.map((panel) => panel.dataset.agendaPanel)).toEqual(
          matrix ? ["2026-12-01", "2026-12-02"] : ["2026-12-01"],
        );
        expect(dayPanels.every((panel) => !panel.hasAttribute("hidden"))).toBe(true);
        expect(document.querySelector("[data-agenda-controls]")?.hasAttribute("hidden")).toBe(true);
        if (matrix) {
          expect(cards[0]!.closest("td")?.colSpan).toBe(2);
          expect(cards[0]!.dataset.agendaSession).toBe("hall overflow");
          const body = cards[0]!.querySelector(".pk-content-agenda__session-body")!;
          expect(body.querySelector("h3")?.textContent).toBe(session.title);
          const description = body.querySelector(".pk-content-agenda__description")!;
          expect(description.querySelector("strong")?.textContent).toBe("Practical transition lessons");
          expect(description.querySelectorAll("p")).toHaveLength(9);
          expect(description.textContent).toContain("Discussion 8: participants compare");
          const credits = [...body.querySelectorAll(".pk-content-agenda__speaker")].filter(
            (credit) => !credit.closest("dialog, [popover]"),
          );
          expect(credits.map((credit) => credit.querySelector("strong")?.textContent)).toEqual([
            "Historical speaker",
            "Synthetic Panelist Alpha",
            "Synthetic Panelist Beta",
            "Synthetic Panelist Gamma",
          ]);
          expect(credits[0]!.textContent).toContain("Moderator");
          for (const credit of credits.slice(1)) expect(credit.textContent).toContain("Panelist");
          expect(credits.map((credit) => credit.querySelector("img") !== null)).toEqual([true, false, true, false]);
          expect(credits[1]!.querySelector(".pk-avatar__initials")?.textContent).toBe("SA");
          expect(credits[3]!.querySelector(".pk-avatar__initials")?.textContent).toBe("SG");
          expect(cards[0]!.querySelector(".pk-content-agenda__room")?.textContent).toBe("Main hall / Overflow hall");
          expect(cards[2]!.querySelector(".pk-content-agenda__room")?.textContent).toBe("Main hall");
          expect(dayPanels[1]!.querySelector('[data-agenda-clock="venue"] time')?.textContent).toBe("11:30");
          expect(dayPanels[1]!.querySelector('[data-agenda-clock="venue"] time')?.getAttribute("datetime")).toBe(
            "2026-12-02T10:30:00.000Z",
          );
          for (const [index, id] of [
            [0, "session"],
            [2, "repeat"],
          ] as const) {
            const projected = content.days
              .flatMap((day) => day.slots.flatMap((slot) => slot.sessions))
              .find((item) => item.id === id)!;
            expect(projected.sessionUrl).toBe(`/events/approved-event/sessions/${id}/`);
            const titleLink = cards[index]!.querySelector("h3 a")!;
            expect(titleLink.getAttribute("href")).toBe(projected.sessionUrl);
            expect(titleLink.getAttribute("data-agenda-open-session")).toBe(targets[index]);
            expect(cards[index]!.querySelector(".pk-content-agenda__actions")?.textContent).not.toContain(
              "Session page",
            );
          }
          expect(document.querySelectorAll(".pk-content-agenda__speakers > article")).toHaveLength(4);
        }
      }
      expect(canonical).toEqual(before);
    },
  );
  it.each(["public", "private", "missing feed"])(
    "authored approved agenda exposes only its actual public calendar (%s)",
    async (scenario) => {
      const agendaPath = "/events/approved-event/agenda/";
      const canonical = agendaSnapshotSchema.parse({
        ...snapshot,
        calendarPublic: scenario !== "private",
        publicAgendaPath: agendaPath,
      });
      const published = sitePublicationSnapshotSchema.parse({
        ...publication,
        eventAgendas: { [canonical.eventSlug]: canonical },
        eventAgendaCalendars:
          scenario === "missing feed"
            ? {}
            : {
                [canonical.eventSlug]: {
                  basis: "approved_history",
                  name: "Approved calendar",
                  timeZone: canonical.timeZone,
                  agendaPath,
                  entries: [],
                },
              },
      });
      const html = await renderContentAgenda(
        {
          assetUrl: () => undefined,
          assetUrls: () => [],
          data: {},
          eventSlug: snapshot.eventSlug,
          listing: () => {
            throw new Error("Unexpected catalog lookup");
          },
          publication: published,
          route: agendaPath,
          sourcePath: "synthetic-authored-agenda.md",
        },
        async () => {
          throw new Error("Unexpected authored fallback");
        },
      );
      const output = document.createElement("div");
      output.innerHTML = html;
      const links = output.querySelectorAll('[aria-label="Public agenda calendar"] a');
      expect(links).toHaveLength(scenario === "public" ? 2 : 0);
      if (scenario === "public") {
        expect(links[0]!.getAttribute("href")).toBe(`webcal://pkic.org${agendaPath}calendar.ics`);
        expect(links[1]!.getAttribute("href")).toBe(`${agendaPath}calendar.ics`);
        expect(links[1]!.hasAttribute("download")).toBe(true);
      }
      expect(html).not.toContain("/api/v1/");
      expect(html).not.toContain("token=");
    },
  );
  it.each(["historical root", "current root", "current agenda", "renamed current root", "ambiguous current root"])(
    "binds a same-slug publication to its owned route (%s)",
    async (scenario) => {
      const eventRoute = "/events/2026/approved-event/";
      const agendaPath = `${eventRoute}agenda/`;
      const historicRoute = "/events/2023/approved-event/";
      const route =
        scenario === "historical root" ? historicRoute : scenario === "current agenda" ? agendaPath : eventRoute;
      const canonical = agendaSnapshotSchema.parse({
        ...snapshot,
        eventSlug: scenario === "renamed current root" ? "new-canonical-event" : snapshot.eventSlug,
        calendarPublic: true,
        publicAgendaPath: agendaPath,
      });
      const published = sitePublicationSnapshotSchema.parse({
        ...publication,
        eventAgendas: {
          [canonical.eventSlug]: canonical,
          ...(scenario === "ambiguous current root"
            ? { other: agendaSnapshotSchema.parse({ ...canonical, eventSlug: "other" }) }
            : {}),
        },
        eventAgendaCalendars: {
          [canonical.eventSlug]: {
            basis: "approved_history",
            name: "Current calendar",
            timeZone: canonical.timeZone,
            agendaPath,
            entries: [],
          },
        },
      });
      const rendered = renderContentAgenda(
        {
          assetUrl: () => undefined,
          assetUrls: () => [],
          data: {},
          eventSlug: snapshot.eventSlug,
          eventRoute: scenario === "historical root" ? historicRoute : eventRoute,
          eventData: {
            name: "Historical conference",
            timezone: "UTC",
            locations: { order: ["hall"], hall: "Historical hall" },
            agenda: {
              "2023-11-07": [
                {
                  time: "9:00",
                  sessions: [{ title: "Opening", description: "Original historical program", locations: ["hall"] }],
                },
              ],
            },
          },
          listing: () => {
            throw new Error("Unexpected listing lookup");
          },
          publication: published,
          route,
          sourcePath: "same-slug-authored-event.md",
        },
        async (value) => String(value ?? ""),
      );
      if (scenario === "ambiguous current root") {
        await expect(rendered).rejects.toThrow(`Ambiguous approved agenda ownership for route ${eventRoute}`);
        return;
      }
      const html = await rendered;
      const output = document.createElement("div");
      output.innerHTML = html;
      if (scenario === "historical root") {
        expect(output.querySelectorAll('[id="sessionModal-900-0-opening"]')).toHaveLength(1);
        expect(html).toContain("Original historical program");
        expect(html).toContain("2023-11-07T09:00:00.000Z");
        expect(html).not.toContain("Approved session");
        expect(output.querySelector('[aria-label="Public agenda calendar"]')).toBeNull();
        expect(html).not.toContain(agendaPath);
      } else {
        expect(html).toContain("Approved session");
        expect(html).not.toContain("Original historical program");
        expect(output.querySelector('[aria-label="Public agenda calendar"] a[download]')?.getAttribute("href")).toBe(
          `${agendaPath}calendar.ics`,
        );
      }
    },
  );
});
