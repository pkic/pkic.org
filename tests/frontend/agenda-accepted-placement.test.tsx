// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { AcceptedProposalDropTarget } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/AcceptedProposalDropTarget";
import {
  useAcceptedProposalPlacement,
  acceptedProposalDragType,
} from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/useAcceptedProposalPlacement";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { saveAcceptedProposalAt } from "../../assets/ts/member-flows/portal/sections/events/detail/agenda/accepted-proposal-placement";
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/agenda/accepted-proposal-placement", () => ({
  saveAcceptedProposalAt: vi.fn(),
}));
const snapshot = agendaSnapshotSchema.parse({
  eventSlug: "event",
  timeZone: "UTC",
  revision: 4,
  publishedRevision: null,
  rooms: [],
  occurrences: [],
  blocks: [],
  roleMembers: [],
  assignments: [],
});
let host: HTMLElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
});
it("maps mouse and keyboard destinations to the same explicit snapped candidate without accepting occurrence IDs", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const place = vi.fn();
  await act(() =>
    render(
      <AcceptedProposalDropTarget
        startAt="2026-12-01T08:03:00.000Z"
        roomId="room"
        roomName="Workshop"
        timeZone="Europe/Amsterdam"
        timeStep={5}
        proposalId="proposal"
        onPlace={place}
      />,
      host,
    ),
  );
  const button = host.querySelector("button")!;
  await act(() => button.click());
  const canonical = place.mock.calls[0];
  const drop = new Event("drop", { bubbles: true });
  Object.defineProperty(drop, "dataTransfer", {
    value: { getData: (type: string) => (type === acceptedProposalDragType ? "proposal" : "") },
  });
  await act(() => {
    button.dispatchEvent(drop);
  });
  expect(place.mock.calls[1]).toEqual(canonical);
  const wrong = new Event("drop", { bubbles: true });
  Object.defineProperty(wrong, "dataTransfer", { value: { getData: () => "occurrence" } });
  await act(() => {
    button.dispatchEvent(wrong);
  });
  expect(place).toHaveBeenCalledTimes(2);
});
it("keeps touch selection until an explicit placement and clears native drag cancellation", async () => {
  host = document.createElement("div");
  document.body.append(host);
  let controller!: ReturnType<typeof useAcceptedProposalPlacement>;
  const saved = vi.fn();
  vi.mocked(saveAcceptedProposalAt).mockResolvedValue({
    agenda: snapshot,
    imported: 1,
    skipped: 0,
    dryRun: false,
    reviewRequired: 0,
  });
  function Harness() {
    controller = useAcceptedProposalPlacement("event", { snapshot, onSaved: saved, canEdit: true });
    return <span>{controller.selected?.title}</span>;
  }
  await act(() => render(<Harness />, host));
  await act(() => controller.select({ id: "proposal", title: "Accepted talk" }));
  await act(() => controller.endDrag());
  expect(controller.selected?.id).toBe("proposal");
  await act(() => controller.place("2026-12-01T08:00:00.000Z", "room"));
  expect(saveAcceptedProposalAt).toHaveBeenCalledWith(snapshot, "proposal", "2026-12-01T08:00:00.000Z", "room");
  expect(saved).toHaveBeenCalledWith(snapshot);
  expect(controller.selected).toBeNull();
  await act(() => controller.cancel());
  expect(controller.selected).toBeNull();
  await act(() => controller.select({ id: "proposal", title: "Accepted talk" }, true));
  await act(() => controller.endDrag());
  expect(controller.selected).toBeNull();
});
