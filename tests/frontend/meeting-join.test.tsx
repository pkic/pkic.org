// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../assets/ts/member-flows/meeting-join/App";
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
  vi.unstubAllGlobals();
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

  it("creates and completes a nested invitation verification before using the canonical join resource", async () => {
    const occurrenceId = "80000000-0000-4000-8000-000000000001";
    const verificationId = "81000000-0000-4000-8000-000000000001";
    const jsonResponse = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ verificationId, expiresAt: "2026-09-01T12:10:00.000Z" }, 202))
      .mockResolvedValueOnce(jsonResponse({ occurrenceId, expiresAt: "2026-09-01T15:00:00.000Z" }))
      .mockResolvedValueOnce(
        jsonResponse({
          occurrence: {
            id: occurrenceId,
            seriesId: "60000000-0000-4000-8000-000000000001",
            eventName: "Canonical meeting entry",
            startsAt: "2026-09-01T13:00:00.000Z",
            endsAt: "2026-09-01T14:00:00.000Z",
            location: "Online",
          },
          name: "Verified Guest",
          affiliation: "External Organization",
          terms: [],
          landingRevision: "a".repeat(64),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(async () => {
      render(<App invitation={{ token: "pkc1_invitation", occurrenceId }} />, container);
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Verify your invitation"));

    const code = container.querySelector<HTMLInputElement>("#meeting-guest-code")!;
    code.value = "ABCDEFGH";
    await act(async () => {
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")!.click();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Canonical meeting entry"));

    const collection = `/api/v1/meetings/occurrences/${occurrenceId}/invitations/verifications`;
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      collection,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ token: "pkc1_invitation" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${collection}/${verificationId}`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ code: "ABCDEFGH" }) }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/v1/meetings/occurrences/${occurrenceId}/join`,
      expect.objectContaining({ method: "GET" }),
    );
  });
});
