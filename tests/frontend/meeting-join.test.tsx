// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeetingJoinForm } from "../../assets/ts/member-flows/meeting-join/MeetingJoinForm";
import {
  consumeMeetingGuestInvitationFragment,
  parseMeetingGuestInvitationFragment,
} from "../../assets/ts/member-flows/meeting-join/invitation-fragment";

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("secure meeting join browser flow", () => {
  it("reads guest credentials only from the fragment and removes them before use", () => {
    expect(parseMeetingGuestInvitationFragment("#/verify?token=secret&occurrence=occurrence-id")).toEqual({
      token: "secret",
      occurrenceId: "occurrence-id",
    });
    expect(parseMeetingGuestInvitationFragment("#token=secret")).toBeNull();
    const replaceState = vi.fn();
    expect(
      consumeMeetingGuestInvitationFragment(
        { hash: "#/verify?token=secret&occurrence=occurrence-id", pathname: "/meetings/join/" } as Location,
        { replaceState } as unknown as History,
      ),
    ).toEqual({ token: "secret", occurrenceId: "occurrence-id" });
    expect(replaceState).toHaveBeenCalledWith({}, "", "/meetings/join/?occurrence=occurrence-id");
  });

  it("renders only the server-authored identity and submits checked current terms", () => {
    const onJoin = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() =>
      render(
        <MeetingJoinForm
          landing={{
            occurrence: {
              id: "80000000-0000-4000-8000-000000000001",
              seriesId: "60000000-0000-4000-8000-000000000001",
              eventName: "Architecture meeting",
              startsAt: "2026-09-01T13:00:00.000Z",
              endsAt: "2026-09-01T14:00:00.000Z",
              location: "Online",
            },
            name: "Authoritative Attendee",
            affiliation: "Example Organization",
            terms: [
              {
                id: "90000000-0000-4000-8000-000000000001",
                key: "meeting-rules",
                version: "v1",
                displayText: "Follow the meeting rules",
                required: true,
                accepted: false,
              },
            ],
            landingRevision: "a".repeat(64),
          }}
          submitting={false}
          error={null}
          onJoin={onJoin}
        />,
        container,
      ),
    );
    expect(container.textContent).toContain("Authoritative Attendee");
    expect(container.textContent).toContain("Example Organization");
    const checkbox = container.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    checkbox.checked = true;
    void act(() => {
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const button = container.querySelector<HTMLButtonElement>("button")!;
    expect(button.disabled).toBe(false);
    void act(() => button.click());
    expect(onJoin).toHaveBeenCalledWith(["90000000-0000-4000-8000-000000000001"]);
  });
});
