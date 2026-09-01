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

/** The control a visible label points at, found the way a reader would. */
function controlLabelled(root: ParentNode, label: string): HTMLInputElement {
  const match = [...root.querySelectorAll("label")].find((candidate) => candidate.textContent?.includes(label));
  const control = match?.htmlFor ? root.querySelector<HTMLInputElement>(`#${match.htmlFor}`) : null;
  if (!control) throw new Error(`No control labelled ${label}`);
  return control;
}

function buttonLabelled(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));
  if (!found) throw new Error(`No button labelled ${label}`);
  return found;
}

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

    // Located by its label rather than by a hard-coded id: the Field owns
    // the id/for pair now, and a name will not break the next time either.
    const code = controlLabelled(container, "Verification code");
    // The control carries the field's ARIA, not just its label.
    expect(code.getAttribute("aria-describedby")).toBeTruthy();
    expect(code.required).toBe(true);
    code.value = "ABCDEFGH";
    await act(async () => {
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      buttonLabelled(container, "Verify invitation").click();
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

  it("renders each term as a real check block and blocks the join until a required one is agreed", () => {
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
            affiliation: null,
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
          onJoin={vi.fn()}
        />,
        container,
      ),
    );

    // All three parts of the check block, not just the outer one: a label
    // carrying `pk-check` alone renders the operating system's own control.
    const label = container.querySelector("label.pk-check")!;
    expect(label.querySelector("input.pk-check__input")).not.toBeNull();
    expect(label.querySelector("span.pk-check__label")?.textContent).toBe("Follow the meeting rules (required)");
    // The identity block is a term/value list, so each value is announced with
    // the term that names it.
    expect([...container.querySelectorAll("dl.pk-datalist > dt")].map((term) => term.textContent)).toEqual([
      "Attendee",
      "Affiliation",
    ]);
    expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  });

  it("states a rejected join in an alert rather than only greying the control", () => {
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
              location: null,
            },
            name: "Authoritative Attendee",
            affiliation: null,
            terms: [],
            landingRevision: "a".repeat(64),
          }}
          submitting
          error="The meeting has already ended."
          onJoin={vi.fn()}
        />,
        container,
      ),
    );

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("The meeting has already ended.");
    // Submitting keeps the control focusable and says so, rather than removing
    // it from under the reader.
    const join = container.querySelector<HTMLButtonElement>("button")!;
    expect(join.getAttribute("aria-busy")).toBe("true");
    expect(join.textContent).toBe("Opening meeting…");
  });

  it("announces the wait instead of miming it with grey text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => undefined)),
    );
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    history.replaceState({}, "", "/?occurrence=80000000-0000-4000-8000-000000000004");
    await act(async () => {
      render(<App invitation={null} />, container);
    });

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Preparing secure meeting entry…");
    history.replaceState({}, "", "/");
  });

  it("attaches a rejected verification code to the control it is about", async () => {
    const occurrenceId = "80000000-0000-4000-8000-000000000002";
    const verificationId = "90000000-0000-4000-8000-000000000002";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST") {
        return Promise.resolve(
          new Response(JSON.stringify({ verificationId, expiresAt: "2026-09-01T13:00:00.000Z" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.includes("/verifications/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: "INVALID_CODE", message: "That code is not correct." } }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(async () => {
      render(<App invitation={{ token: "pkc1_invitation", occurrenceId }} />, container);
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Verify your invitation"));

    const code = controlLabelled(container, "Verification code");
    code.value = "WRONGCDE";
    await act(async () => {
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      buttonLabelled(container, "Verify invitation").click();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("That code is not correct."));

    // The failure is the control's own, not a red box somewhere near it.
    expect(code.getAttribute("aria-invalid")).toBe("true");
    const describedBy = code.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const message = container.querySelector(`#${describedBy ?? ""}`);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("That code is not correct.");
  });

  it("tells an unauthenticated visitor with no invitation what to do next", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "unauthorized", message: "Sign in required." } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    history.replaceState({}, "", "/?occurrence=80000000-0000-4000-8000-000000000003");
    await act(async () => {
      render(<App invitation={null} />, container);
    });
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.classList.contains("pk-alert--warn")).toBe(true);
    expect(alert?.textContent).toContain("Sign in required.");
    history.replaceState({}, "", "/");
  });
});
