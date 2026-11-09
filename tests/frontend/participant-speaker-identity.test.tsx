// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { ParticipantSpeaker } from "../../assets/ts/components/events/ParticipantSpeaker";
import { participantSpeakerFixture } from "./helpers/participant-speaker-fixture";
import { eventProposalProofVerifySchema } from "../../assets/shared/schemas/event-proposal-proof";
import { speakerSelfProfilePatchSchema } from "../../assets/shared/schemas/proposal-management";
import { completeIndependentCapacityDisclosure } from "./helpers/independent-capacity";

vi.mock("../../assets/ts/components/markdown-editor/MarkdownInput", () => ({ MarkdownEditor: () => null }));
const id = "00000000-0000-4000-8000-000000000041";
const at = "2026-01-01T00:00:00.000Z";
const data = participantSpeakerFixture();
let host: HTMLDivElement;
afterEach(() => {
  render(null, host);
  host.remove();
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

it("requires speaker terms before resolving identity, preserves refusal, and saves explicit individual selection before confirmation", async () => {
  const writes: { path: string; body: unknown }[] = [];
  let recorded = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      writes.push({ path, body });
      if (path.endsWith("/profile")) {
        const selected = speakerSelfProfilePatchSchema.parse(body);
        expect(selected.actingIdentityId).toBeNull();
        expect(selected.unaffiliatedAttestation).toBe(true);
        expect(selected.consents).toBeUndefined();
        recorded = true;
        return response({
          success: true,
          profile: { ...data.profile, actingIdentitySelection: "individual", actingIdentitySelectedAt: at },
          currentRepresentation: null,
        });
      }
      return recorded
        ? response({ success: true, status: "confirmed" })
        : response(
            {
              error: {
                code: "IDENTITY_REQUIRED",
                message: "Confirm your speaker identity before confirming participation.",
              },
            },
            409,
          );
    }
    if (path === "/api/v1/auth/session")
      return response({
        success: true,
        sessionId: id,
        identity: { id, email: data.profile.email },
        eventParticipation: true,
        expiresAt: "2099-12-31T23:59:59.000Z",
        idleExpiresAt: "2099-12-31T23:59:59.000Z",
      });
    if (path === `/api/v1/users/${id}`)
      return response({
        user: {
          id,
          email: data.profile.email,
          first_name: "Ada",
          last_name: "Lovelace",
          preferred_name: null,
          active: true,
          isEcMember: false,
          created_at: at,
          updated_at: at,
          pii_redacted_at: null,
          headshotUrl: null,
          identities: [],
          formerIdentities: [],
        },
      });
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <ParticipantSpeaker
        data={data}
        eventSlug="pqc-2026"
        terms={[{ termKey: "speaker-agreement", version: "1", required: true, contentRef: null }]}
        reload={async () => {}}
      />,
      host,
    ),
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(host.querySelector('input[name="firstName"]')).toBeNull();
  expect(host.querySelector('input[name="organizationName"]')).toBeNull();
  expect(
    Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === EMAIL_FIRST_COPY.speaker.individualSwitch,
    ),
  ).toBeUndefined();
  await act(() => {
    host.querySelector<HTMLInputElement>("input[data-consent-input]")!.click();
  });
  await vi.waitFor(() =>
    expect(
      Array.from(host.querySelectorAll("button")).find(
        (button) => button.textContent === EMAIL_FIRST_COPY.speaker.individualSwitch,
      ),
    ).toBeDefined(),
  );
  const forms = host.querySelectorAll("form");
  const confirm = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Confirm willingness to participate",
  );
  expect(confirm?.disabled).toBe(true);
  expect(host.textContent).toContain("choose and save your speaker identity before confirming");
  await act(async () => {
    forms[0]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Confirm your speaker identity before confirming participation."),
  );
  expect(recorded).toBe(false);
  await act(() => {
    Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === EMAIL_FIRST_COPY.speaker.individualSwitch)!
      .click();
  });
  await completeIndependentCapacityDisclosure(host);
  await act(async () => {
    forms[1]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(recorded).toBe(true));
  await act(async () => {
    forms[0]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Your willingness to participate in this proposal is confirmed."),
  );
  expect(writes.map((write) => write.path)).toEqual([
    `/api/v1/proposals/${id}/participation`,
    `/api/v1/proposals/${id}/participation/profile`,
    `/api/v1/proposals/${id}/participation`,
  ]);
});

it("resumes a speaker-bound email proof inside the portal route and clears only the consumed proof after saved selection", async () => {
  const token = "v".repeat(40);
  const continuationToken = "c".repeat(40);
  const route = `/events/pqc-2026/proposals/${id}/participation`;
  history.replaceState({}, "", `/portal/#${route}?verify=${token}`);
  const requests: { path: string; body: unknown }[] = [];
  let profileAttempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const body = JSON.parse(String(init?.body));
      requests.push({ path, body });
      if (path.endsWith("/verify")) {
        const verified = eventProposalProofVerifySchema.parse(body);
        expect(verified.token).toBe(token);
        expect(verified.speakerProposalId).toBe(id);
        return response({
          status: "ready",
          consents: [{ termKey: "speaker-agreement", version: "1" }],
          continuationToken,
          applicantKind: "individual",
          email: data.profile.email,
          person: {
            email: data.profile.email,
            firstName: "Ada",
            lastName: "Lovelace",
            organizationName: null,
            jobTitle: null,
            bio: null,
            links: [],
          },
          organization: null,
          speakerProposalId: id,
          speakerManageUrl: `https://example.test/portal/#${route}`,
        });
      }
      const selected = speakerSelfProfilePatchSchema.parse(body);
      expect(selected.continuationToken).toBe(continuationToken);
      expect(selected.actingIdentityId).toBeNull();
      expect(selected.unaffiliatedAttestation).toBe(true);
      if (++profileAttempts === 1)
        return response({ error: { code: "SAVE_REFUSED", message: "Please retry saving this speaker profile." } }, 409);
      return response({
        success: true,
        profile: { ...data.profile, actingIdentitySelection: "individual", actingIdentitySelectedAt: at },
        currentRepresentation: null,
      });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <ParticipantSpeaker
        data={data}
        eventSlug="pqc-2026"
        terms={[{ termKey: "speaker-agreement", version: "1", required: true, contentRef: null }]}
        reload={async () => {}}
      />,
      host,
    ),
  );
  // The link carries the terms agreed before it was sent: it is read at once and the terms are not asked again.
  await vi.waitFor(() => expect(host.textContent).toContain("Individual participation"));
  for (const term of host.querySelectorAll<HTMLInputElement>("input[data-consent-input]"))
    expect(term.checked).toBe(true);
  await completeIndependentCapacityDisclosure(host);
  expect(requests.map((request) => request.path)).toEqual(["/api/v1/events/pqc-2026/proposals/proof/verify"]);
  expect(location.hash).toContain(`verify=${token}`);
  await act(async () => {
    host.querySelectorAll("form")[1]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Please retry saving this speaker profile."));
  expect(location.hash).toBe(`#${route}?verify=${token}`);
  await act(async () => {
    host.querySelectorAll("form")[1]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Speaker identity saved."));
  expect(location.pathname).toBe("/portal/");
  expect(location.hash).toBe(`#${route}`);
  expect(requests.map((request) => request.path)).toEqual([
    "/api/v1/events/pqc-2026/proposals/proof/verify",
    `/api/v1/proposals/${id}/participation/profile`,
    `/api/v1/proposals/${id}/participation/profile`,
  ]);
});

it("shows late review without offering self-confirmation or promising a program place", async () => {
  host = document.createElement("div");
  document.body.append(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ identities: [] })),
  );
  await act(() =>
    render(
      <ParticipantSpeaker
        data={{ ...data, speaker: { ...data.speaker, status: "pending", termsAcceptedAt: at, awaitingReview: true } }}
        eventSlug="pqc-2026"
        terms={[]}
        reload={async () => {}}
      />,
      host,
    ),
  );
  expect(host.textContent).toContain("Your response arrived after the invitation deadline.");
  expect(host.textContent).toContain("A replacement may already exist.");
  expect(host.textContent).toContain("awaits organizer approval");
  expect(
    [...host.querySelectorAll("button")].some((button) => button.textContent === "Confirm willingness to participate"),
  ).toBe(false);
});

it.each(["invited", "confirmed", "pending"] as const)(
  "restores saved term versions for a %s speaker after reopening the proposal",
  async (status) => {
    host = document.createElement("div");
    document.body.append(host);
    const saved = {
      ...data,
      acceptedConsents: [{ termKey: "privacy", version: "1" }],
      speaker: { ...data.speaker, status, termsAcceptedAt: at, awaitingReview: status === "pending" },
    };
    const terms = [
      { termKey: "privacy", version: "1", required: true, contentRef: null },
      { termKey: "recording", version: "2", required: false, contentRef: null },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ identities: [] })),
    );
    for (let visit = 0; visit < 2; visit++) {
      await act(() =>
        render(<ParticipantSpeaker data={saved} eventSlug="pqc-2026" terms={terms} reload={async () => {}} />, host),
      );
      const checkboxes = [...host.querySelectorAll<HTMLInputElement>("input[data-consent-input]")];
      expect(checkboxes.length).toBeGreaterThan(0);
      for (const checkbox of checkboxes) expect(checkbox.checked).toBe(checkbox.value === "privacy:1");
      await act(() => render(null, host));
    }
  },
);

it("requires acceptance of a replacement term version even when an earlier version was saved", async () => {
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <ParticipantSpeaker
        data={{
          ...data,
          acceptedConsents: [{ termKey: "privacy", version: "1" }],
          speaker: { ...data.speaker, termsAcceptedAt: at },
        }}
        eventSlug="pqc-2026"
        terms={[{ termKey: "privacy", version: "2", required: true, contentRef: null }]}
        reload={async () => {}}
      />,
      host,
    ),
  );
  expect(host.querySelector<HTMLInputElement>("input[data-consent-input]")?.checked).toBe(false);
  expect(host.textContent).toContain("Accept the speaker terms above to choose your speaker identity.");
});

it("reviews replacement terms and keeps the saved acceptance after reload and Cancel", async () => {
  host = document.createElement("div");
  document.body.append(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response({ identities: [] })),
  );
  const saved = participantSpeakerFixture();
  saved.speaker.status = "confirmed";
  saved.profile.actingIdentitySelection = "individual";
  saved.profile.actingIdentitySelectedAt = at;
  const terms = [{ termKey: "privacy", version: "2", required: true, contentRef: null }];
  const show = async () =>
    act(() =>
      render(<ParticipantSpeaker data={saved} eventSlug="pqc-2026" terms={terms} reload={async () => {}} />, host),
    );
  const click = async (label: string) =>
    act(() => {
      const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label);
      expect(button, label).toBeDefined();
      button!.click();
    });
  await show();
  expect(host.textContent).toContain("Some current speaker terms have not been accepted.");
  expect(host.querySelector("input[data-consent-input]")).toBeNull();
  await click("Review speaker terms and identity");
  const checkbox = host.querySelector<HTMLInputElement>("input[data-consent-input]")!;
  expect(checkbox.matches(":disabled")).toBe(false);
  await act(() => checkbox.click());
  // A successful identity save returns fresh receipts and a fresh selection timestamp.
  saved.acceptedConsents = [{ termKey: "privacy", version: "2" }];
  saved.profile.actingIdentitySelectedAt = "2026-01-02T00:00:00.000Z";
  await show();
  await click("Choose another representation");
  await click("Cancel");
  await click("Choose another representation");
  expect(host.querySelector<HTMLInputElement>("input[data-consent-input]")?.checked).toBe(true);
  expect(host.textContent).not.toContain("Accept the speaker terms above to choose your speaker identity.");
});

it("labels event agreements as already accepted when opening another invitation", async () => {
  host = document.createElement("div");
  document.body.append(host);
  const saved = participantSpeakerFixture();
  saved.profile.actingIdentitySelection = "individual";
  saved.profile.actingIdentitySelectedAt = at;
  saved.acceptedConsents = [{ termKey: "privacy", version: "1" }];
  await act(() =>
    render(
      <ParticipantSpeaker
        data={saved}
        eventSlug="pqc-2026"
        terms={[
          { termKey: "privacy", version: "1", required: true, contentRef: null },
          { termKey: "recording", version: "2", required: true, contentRef: null },
        ]}
        reload={async () => {}}
      />,
      host,
    ),
  );
  expect(host.textContent).toContain("You already agreed to these terms for this event.");
  const privacy = host.querySelector<HTMLInputElement>('input[value="privacy:1"]')!;
  const recording = host.querySelector<HTMLInputElement>('input[value="recording:2"]')!;
  expect(privacy.checked).toBe(true);
  expect(privacy.matches(":disabled")).toBe(true);
  expect(recording.checked).toBe(false);
  expect(recording.matches(":disabled")).toBe(false);
});
