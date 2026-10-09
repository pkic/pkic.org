// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { ParticipantSpeaker } from "../../assets/ts/components/events/ParticipantSpeaker";
import { speakerSelfServiceReadResponseSchema } from "../../assets/shared/schemas/speaker-self-service";
import { eventProposalProofVerifySchema } from "../../assets/shared/schemas/event-proposal-proof";
import { speakerSelfProfilePatchSchema } from "../../assets/shared/schemas/proposal-management";

vi.mock("../../assets/ts/components/markdown-editor/MarkdownInput", () => ({ MarkdownEditor: () => null }));
const id = "00000000-0000-4000-8000-000000000041";
const at = "2026-01-01T00:00:00.000Z";
const data = speakerSelfServiceReadResponseSchema.parse({
  speaker: {
    userId: id,
    role: "speaker",
    status: "invited",
    confirmedAt: null,
    declinedAt: null,
    termsAcceptedAt: null,
  },
  proposal: {
    id,
    title: "Speaker session",
    proposalType: "talk",
    status: "submitted",
    presentationDeadline: null,
    presentationUploaded: false,
    presentationUploadedAt: null,
    presentationUploader: null,
    coSpeakers: [],
    presentationUrl: null,
  },
  profile: {
    email: "ada@example.test",
    firstName: "Ada",
    lastName: "Lovelace",
    organizationName: null,
    jobTitle: null,
    biography: null,
    links: [],
    headshotUploaded: false,
    headshotUpdatedAt: null,
    headshotUrl: null,
    actingIdentityId: null,
    actingIdentitySelectedAt: null,
    actingIdentitySelection: "unrecorded",
  },
  currentRepresentation: null,
  presentationTerms: [],
});
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
        expect(selected.consents).toEqual([{ termKey: "speaker-agreement", version: "1" }]);
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
  expect(host.querySelector('input[value="individual"]')).toBeNull();
  await act(() => {
    host.querySelector<HTMLInputElement>("input[data-consent-input]")!.click();
  });
  await vi.waitFor(() => expect(host.querySelector('input[value="individual"]')).not.toBeNull());
  const forms = host.querySelectorAll("form");
  await act(async () => {
    forms[0]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Confirm your speaker identity before confirming participation."),
  );
  expect(recorded).toBe(false);
  await act(() => {
    host.querySelector<HTMLInputElement>('input[value="individual"]')!.click();
  });
  await act(async () => {
    forms[1]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(recorded).toBe(true));
  await act(async () => {
    forms[0]!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Participation confirmed."));
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
  expect(requests).toHaveLength(0);
  await act(() => {
    host.querySelector<HTMLInputElement>("input[data-consent-input]")!.click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Individual participation"));
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
  await vi.waitFor(() => expect(host.textContent).toContain("Speaker profile saved."));
  expect(location.pathname).toBe("/portal/");
  expect(location.hash).toBe(`#${route}`);
  expect(requests.map((request) => request.path)).toEqual([
    "/api/v1/events/pqc-2026/proposals/proof/verify",
    `/api/v1/proposals/${id}/participation/profile`,
    `/api/v1/proposals/${id}/participation/profile`,
  ]);
});
