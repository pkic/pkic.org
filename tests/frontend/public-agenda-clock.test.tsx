// @vitest-environment jsdom
import { renderToStringAsync } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { contractClock } from "../../assets/shared/event-clock";
import { agendaContent } from "../../assets/shared/public-agenda-content";
import type { AgendaSnapshot } from "../../assets/shared/schemas/event-agenda";
import { ContentAgenda } from "../../assets/ts/site/ContentAgenda";
import { publicAgendaProjection } from "../../functions/_lib/services/event-agenda/public-projection";
import { approvedAgendaSnapshot } from "../fixtures/approved-agenda";

/** The same approved agenda, moved to an Austin venue on the Chicago zone. */
const austinAgenda: AgendaSnapshot = {
  ...structuredClone(approvedAgendaSnapshot),
  timeZone: "America/Chicago",
  clockCity: "Stale",
};

async function rendered(snapshot: AgendaSnapshot) {
  const content = agendaContent(snapshot);
  const host = document.createElement("div");
  host.innerHTML = await renderToStringAsync(
    <ContentAgenda days={content.days} speakers={content.speakers} timeZone={contractClock(snapshot)} />,
  );
  return host;
}

describe("the public agenda's clock", () => {
  it("is named live by the event's city, never by a frozen one or the zone's", async () => {
    const projected = publicAgendaProjection(austinAgenda, {
      basePath: null,
      visibility: "public",
      city: "Austin",
      country: "US",
    });
    expect(projected.clockCity).toBe("Austin");
    expect(projected.eventPlace).toEqual({ city: "Austin", country: "US" });
    const host = await rendered(projected);
    const root = host.querySelector<HTMLElement>(".pk-content-agenda")!;
    expect(root.dataset.agendaTimeZone).toBe("America/Chicago");
    expect(root.dataset.agendaClockCity).toBe("Austin");
    expect(host.querySelector("[data-agenda-time-face]")?.textContent).toBe("Austin");
    expect(host.querySelector('option[value="venue"]')?.textContent).toMatch(/^Austin \(UTC−[56]\) — event$/u);
    // The picker's other zones keep their own cities, Chicago among them.
    expect(host.querySelector('option[value="America/Chicago"]')).toBeNull();
    expect(host.querySelector('option[value="America/New_York"]')?.textContent).toMatch(/^New York /u);
  });

  it("falls back to the zone's city when the event has no city", async () => {
    const projected = publicAgendaProjection(austinAgenda, {
      basePath: null,
      visibility: "public",
      city: null,
      country: null,
    });
    expect(projected.clockCity).toBeNull();
    const host = await rendered(projected);
    expect(host.querySelector("[data-agenda-time-face]")?.textContent).toBe("Chicago");
  });
});
