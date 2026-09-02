// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  meetingInvitationVerificationUpdateSchema,
  meetingJoinConfirmSchema,
} from "../../assets/shared/schemas/meeting-entry";
import { App } from "../../assets/ts/member-flows/meeting-join/App";
import { MeetingJoinForm } from "../../assets/ts/member-flows/meeting-join/MeetingJoinForm";
import {
  consumeMeetingGuestInvitationFragment,
  parseMeetingGuestInvitationFragment,
} from "../../assets/ts/member-flows/meeting-join/invitation-fragment";

const mounted: HTMLElement[] = [];

const occurrence = {
  id: "80000000-0000-4000-8000-000000000001",
  seriesId: "60000000-0000-4000-8000-000000000001",
  eventName: "Architecture meeting",
  startsAt: "2026-09-01T13:00:00.000Z",
  endsAt: "2026-09-01T14:00:00.000Z",
  location: "Online",
};

const rulesTerm = {
  id: "90000000-0000-4000-8000-000000000001",
  key: "meeting-rules",
  version: "v1",
  displayText: "Follow the meeting rules",
  required: true,
  accepted: false,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fieldOf(control: HTMLElement): HTMLElement {
  return control.closest<HTMLElement>(".pk-field")!;
}

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
    // What is handed on is the join contract's own output: the accepted
    // term with its version, the landing revision, the explicit intent.
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(meetingJoinConfirmSchema.parse(onJoin.mock.calls[0][0])).toEqual({
      landingRevision: "a".repeat(64),
      acceptedTerms: [{ termId: "90000000-0000-4000-8000-000000000001", version: "v1" }],
      intentionalJoin: true,
    });
  });

  it("posts the join the shared contract describes and follows the redirect it returns", async () => {
    const occurrenceId = occurrence.id;
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        requests.push({ url, method: init?.method ?? "GET", body });
        if ((init?.method ?? "GET") === "GET") {
          return jsonResponse({
            occurrence,
            name: "Authoritative Attendee",
            affiliation: null,
            terms: [rulesTerm],
            landingRevision: "a".repeat(64),
          });
        }
        return jsonResponse({
          confirmationId: "82000000-0000-4000-8000-000000000001",
          confirmedAt: "2026-09-01T13:00:00.000Z",
          redirectUrl: "https://meet.example.test/room?token=0123456789abcdef",
        });
      }),
    );
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, search: `?occurrence=${occurrenceId}`, assign });

    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    await act(async () => {
      render(<App invitation={null} />, container);
    });
    await vi.waitFor(() => expect(container.textContent).toContain("Architecture meeting"));

    const checkbox = container.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    await act(async () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      buttonLabelled(container, "Agree and join meeting").click();
    });
    await vi.waitFor(() => expect(assign).toHaveBeenCalled());

    const join = requests.find((request) => request.method === "POST");
    expect(join?.url).toBe(`/api/v1/meetings/occurrences/${occurrenceId}/join`);
    // The body has to satisfy the contract the route parses it with.
    expect(meetingJoinConfirmSchema.parse(join?.body)).toEqual({
      landingRevision: "a".repeat(64),
      acceptedTerms: [{ termId: rulesTerm.id, version: "v1" }],
      intentionalJoin: true,
    });
    expect(assign).toHaveBeenCalledWith("https://meet.example.test/room?token=0123456789abcdef");
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
    const [, verify] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(fetchMock.mock.calls[1][0]).toBe(`${collection}/${verificationId}`);
    expect(verify.method).toBe("PATCH");
    // The code is what the verification contract makes of the draft.
    expect(meetingInvitationVerificationUpdateSchema.parse(JSON.parse(String(verify.body)))).toEqual({
      code: "ABCDEFGH",
    });
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

  /** Mounts the guest verification step with the verification endpoint answering `verify`. */
  async function mountVerification(occurrenceId: string, verify: () => Response) {
    const verificationId = "90000000-0000-4000-8000-000000000002";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if ((init?.method ?? "GET") === "POST") {
        return Promise.resolve(jsonResponse({ verificationId, expiresAt: "2026-09-01T13:00:00.000Z" }));
      }
      if (url.includes("/verifications/")) return Promise.resolve(verify());
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
    return { container, fetchMock };
  }

  async function typeCode(container: HTMLElement, value: string): Promise<HTMLInputElement> {
    const code = controlLabelled(container, "Verification code");
    code.value = value;
    await act(async () => {
      code.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return code;
  }

  it("refuses a code the contract rejects on the control, live, and sends nothing", async () => {
    const { container, fetchMock } = await mountVerification("80000000-0000-4000-8000-000000000002", () =>
      jsonResponse({ occurrenceId: "80000000-0000-4000-8000-000000000002", expiresAt: "2026-09-01T15:00:00.000Z" }),
    );

    // Too short, and containing a character the code alphabet leaves out: the
    // contract says so on the control as it is typed, and the button waits.
    const code = await typeCode(container, "ABC");
    expect(fieldOf(code).classList.contains("pk-field--invalid")).toBe(true);
    expect(code.getAttribute("aria-invalid")).toBe("true");
    const message = container.querySelector(`#${code.getAttribute("aria-describedby") ?? ""}`);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(buttonLabelled(container, "Verify invitation").disabled).toBe(true);
    await act(async () => {
      buttonLabelled(container, "Verify invitation").click();
    });
    expect(
      fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH"),
    ).toHaveLength(0);

    // Corrected: the control says it is good and the button is live.
    await typeCode(container, "abcdefgh");
    expect(code.value).toBe("ABCDEFGH");
    expect(fieldOf(code).classList.contains("pk-field--ok")).toBe(true);
    expect(buttonLabelled(container, "Verify invitation").disabled).toBe(false);
  });

  it("attaches a code the server refuses by name to the control it is about", async () => {
    const { container } = await mountVerification("80000000-0000-4000-8000-000000000002", () =>
      jsonResponse(
        {
          error: {
            code: "VALIDATION",
            message: "Invalid request",
            details: { fieldErrors: { code: ["That code is not correct."] } },
          },
        },
        400,
      ),
    );

    const code = await typeCode(container, "WRNGCDEX");
    await act(async () => {
      buttonLabelled(container, "Verify invitation").click();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("That code is not correct."));

    // The failure is the control's own, not a red box somewhere near it.
    expect(fieldOf(code).classList.contains("pk-field--invalid")).toBe(true);
    expect(code.getAttribute("aria-invalid")).toBe("true");
    const message = container.querySelector(`#${code.getAttribute("aria-describedby") ?? ""}`);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toContain("That code is not correct.");
    expect(document.activeElement).toBe(code);
  });

  it("states a refusal the server does not attribute to the code beside the control", async () => {
    const { container } = await mountVerification("80000000-0000-4000-8000-000000000002", () =>
      jsonResponse({ error: { code: "CHALLENGE_EXPIRED", message: "The challenge expired." } }, 410),
    );

    const code = await typeCode(container, "WRNGCDEX");
    await act(async () => {
      buttonLabelled(container, "Verify invitation").click();
    });
    await vi.waitFor(() => expect(container.textContent).toContain("The challenge expired."));

    // The code said nothing wrong by the contract, so it is not marked; the
    // refusal is announced on its own, where the reader is.
    expect(code.getAttribute("aria-invalid")).toBeNull();
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.classList.contains("pk-alert--danger")).toBe(true);
    expect(alert?.textContent).toContain("The challenge expired.");
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
