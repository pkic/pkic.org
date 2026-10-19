import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { useAgendaInteractionLock } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/useAgendaInteractionLock";
import {
  AgendaEditingControl,
  AgendaEditingWarning,
} from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AgendaEditingControl";
const host = document.createElement("div");
afterEach(() => {
  render(null, host);
  vi.unstubAllGlobals();
});
function Harness({ slug }: { slug: string }) {
  const lock = useAgendaInteractionLock(slug);
  return <AgendaEditingControl locked={lock.locked} onToggle={lock.toggle} />;
}
it("requires explicit editing, ignores saved unlocks and resets across event changes", async () => {
  const getItem = vi.fn(() => "false");
  vi.stubGlobal("localStorage", { getItem });
  await act(() => render(<Harness slug="first" />, host));
  expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Enable agenda editing");
  expect(getItem).not.toHaveBeenCalled();
  await act(() => host.querySelector("button")!.click());
  expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Stop editing");
  await act(() => render(<Harness slug="second" />, host));
  expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
  await act(() => render(<Harness slug="first" />, host));
  expect(host.querySelector("button")?.getAttribute("aria-pressed")).toBe("false");
});
it("warns only when editing an ended event, including a past event with an unknown end", () => {
  const snapshot = agendaSnapshotSchema.parse({
    eventSlug: "past",
    timeZone: "America/Chicago",
    revision: 1,
    publishedRevision: null,
    eventStartsAt: "2000-01-01T10:00:00.000Z",
    eventEndsAt: "2000-01-02T10:00:00.000Z",
    rooms: [],
    occurrences: [],
    shifts: [],
    roleMembers: [],
    assignments: [],
  });
  render(<AgendaEditingWarning snapshot={snapshot} enabled={false} />, host);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  render(<AgendaEditingWarning snapshot={snapshot} enabled />, host);
  expect(host.textContent).toContain("historical agenda");
  render(
    <AgendaEditingWarning
      snapshot={{ ...snapshot, eventStartsAt: "2999-01-01T10:00:00.000Z", eventEndsAt: null }}
      enabled
    />,
    host,
  );
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
