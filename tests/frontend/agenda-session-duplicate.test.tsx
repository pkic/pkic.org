import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import {
  agendaContentPlacementSchema,
  agendaContentPlacementResponseSchema,
} from "../../assets/shared/schemas/event-agenda-content";
import { SessionDuplicate } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/SessionDuplicate";
const source = agendaSnapshotSchema.parse({
  eventSlug: "duplicate-event",
  timeZone: "UTC",
  revision: 3,
  publishedRevision: 2,
  rooms: [],
  shifts: [],
  roleMembers: [],
  assignments: [],
  occurrences: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      contentId: "22222222-2222-4222-8222-222222222222",
      title: "Repeated session",
      description: "Abstract",
      startAt: "2026-12-01T10:00:00.000Z",
      endAt: "2026-12-01T10:30:00.000Z",
      roomId: null,
      speakers: [],
    },
  ],
});
let host: HTMLDivElement;
async function mount(contentId: string | null = "22222222-2222-4222-8222-222222222222") {
  host = document.createElement("div");
  document.body.append(host);
  const saved = vi.fn(),
    close = vi.fn();
  await act(() =>
    render(
      <SessionDuplicate
        snapshot={source}
        session={{ ...source.occurrences[0]!, contentId }}
        onSaved={saved}
        onClose={close}
      />,
      host,
    ),
  );
  return { saved, close };
}
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
describe("duplicate session confirmation", () => {
  it.each(["22222222-2222-4222-8222-222222222222", null])(
    "duplicates content %s only after confirmation and accepts canonical refreshed state",
    async (contentId) => {
      const duplicate = {
        ...source.occurrences[0]!,
        id: "33333333-3333-4333-8333-333333333333",
        startAt: null,
        endAt: null,
        visibility: "private" as const,
        admissionPolicy: "preference" as const,
      };
      const next = agendaSnapshotSchema.parse({
        ...source,
        revision: 4,
        occurrences: [...source.occurrences, duplicate],
      });
      const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
        expect(agendaContentPlacementSchema.parse(JSON.parse(String(init.body)))).toEqual({
          expectedRevision: 3,
          copyAsNew: false,
        });
        return Response.json(
          agendaContentPlacementResponseSchema.parse({
            agenda: next,
            occurrenceId: duplicate.id,
            contentId: duplicate.contentId,
          }),
        );
      });
      vi.stubGlobal("fetch", fetcher);
      const { saved, close } = await mount(contentId);
      expect(fetcher).not.toHaveBeenCalled();
      expect(host.textContent).toContain("unscheduled, private occurrence");
      expect(host.textContent).toContain("Reservations, attendance");
      await act(async () =>
        [...host.querySelectorAll<HTMLButtonElement>("button")]
          .find((button) => button.textContent === "Duplicate session")!
          .click(),
      );
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(
        "/api/v1/events/duplicate-event/agenda/occurrences/11111111-1111-4111-8111-111111111111/placements",
        expect.objectContaining({ method: "POST" }),
      );
      await vi.waitFor(() => expect(saved).toHaveBeenCalledExactlyOnceWith(next));
      expect(close).toHaveBeenCalledOnce();
    },
  );
  it("preserves the confirmation on revision refusal without accepting a new occurrence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "AGENDA_REVISION_CONFLICT", message: "Agenda changed. Reload and try again." } },
          { status: 409 },
        ),
      ),
    );
    const { saved, close } = await mount(null);
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "Duplicate session")!
        .click(),
    );
    expect(saved).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await vi.waitFor(async () => {
      await act(async () => {
        await Promise.resolve();
      });
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
    });
    expect(host.textContent).toContain("Agenda changed. Reload and try again.");
  });
});
