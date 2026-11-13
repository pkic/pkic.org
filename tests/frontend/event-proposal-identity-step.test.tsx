// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { JOB_TITLE_REQUIRED } from "../../assets/shared/schemas/api-common";
import {
  eventProposalProofVerifySchema,
  eventProposalProofStartSchema,
  eventProposalProofPersonPatchSchema,
  eventProposalProofIdentityPatchSchema,
} from "../../assets/shared/schemas/event-proposal-proof";
import type { ProposalEntrySelection } from "../../assets/ts/components/useProposalEntryIdentity";

import {
  proposalProofResponse as response,
  proposalProofEndpoint as endpoint,
  proposalProofToken as TOKEN,
} from "./helpers/proposal-proof-response";

import {
  chooseProposalOrganization,
  chooseProposerIdentity,
  mountProposalIdentityStep,
  proposerIdentity,
  PROPOSER_IDENTITY_ID as identityId,
  signedInProposer,
  SPEAKER_LINK,
} from "./helpers/proposal-identity-fixture";

let host: HTMLDivElement | undefined;
let selection: ProposalEntrySelection | null;
/** A proposer's step, or, with `speaker`, a speaker's on their own link: only a speaker confirms a mailbox. */
async function mount(enabled = true, speaker = false) {
  host = await mountProposalIdentityStep({
    enabled,
    onChange: (value) => {
      selection = value;
    },
    ...(speaker ? SPEAKER_LINK : {}),
  });
}
/** Answers a signed-in proposer's reads, hands every other request to `other`, and records each URL. */
function stubAccount(
  account: ReturnType<typeof signedInProposer>,
  other: (url: URL, init: RequestInit) => Response = () => {
    throw new Error("Unexpected request");
  },
): URL[] {
  const urls: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), location.origin);
      urls.push(url);
      return account(url.pathname) ?? other(url, init);
    }),
  );
  return urls;
}
function clickButton(root: ParentNode, label: string) {
  return act(async () => {
    [...root.querySelectorAll("button")].find((button) => button.textContent === label)!.click();
  });
}
function type(root: ParentNode, name: string, value: string) {
  return act(() => {
    const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
afterEach(async () => {
  const mounted = host;
  if (mounted) await act(() => render(null, mounted));
  document.body.innerHTML = "";
  host = undefined;
  selection = null;
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});
describe("proposal and speaker identity step", () => {
  it("does not resolve profiles or send proof before the terms step activates", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await mount(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(host!.textContent).toBe("");
  });
  it("does not load a different signed-in account's profile or catalog for a speaker invitation", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) => {
        paths.push(String(input));
        return response({
          success: true,
          sessionId: "00000000-0000-4000-8000-000000000095",
          identity: { id: "00000000-0000-4000-8000-000000000099", email: "other@example.test" },
          eventParticipation: true,
          expiresAt: "2099-12-31T23:59:59.000Z",
          idleExpiresAt: "2099-12-31T23:59:59.000Z",
        });
      }),
    );
    await mount(true, true);
    await vi.waitFor(() => expect(host!.querySelector('input[name="email"], [role="combobox"]')).not.toBeNull());
    expect(host!.querySelector('input[name="email"]')).not.toBeNull();
    expect(host!.querySelector('[role="combobox"]')).toBeNull();
    expect(paths).toEqual(["/api/v1/auth/session"]);
    expect(selection).toBeNull();
  });
  it("uses a speaker's confirmed details as a summary without personal inputs", async () => {
    history.replaceState({}, "", `/events/2026/pqc-2026/speaker/#verify=${TOKEN}`);
    const requests: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return response({
          status: "ready",
          consents: [],
          continuationToken: "c".repeat(40),
          applicantKind: "organization",
          email: "ada@example.test",
          organization: { id: "00000000-0000-4000-8000-000000000044", name: "Example Organization", jobTitle: null },
          person: {
            email: "ada@example.test",
            firstName: "Ada",
            lastName: "Lovelace",
            organizationName: null,
            jobTitle: null,
            bio: null,
            links: [],
          },
        });
      }),
    );
    await mount(true, true);
    await vi.waitFor(() => expect(selection?.person.firstName).toBe("Ada"));
    expect(eventProposalProofVerifySchema.parse(requests[0])).toMatchObject({
      token: TOKEN,
      speakerManagementToken: SPEAKER_LINK.speakerManagementToken,
    });
    expect(host!.querySelector(".pk-datalist")?.textContent).toContain("Ada Lovelace");
    expect(host!.querySelector(".pk-datalist")?.textContent).not.toContain("Example Organization");
    expect(host!.querySelector('input[name="firstName"]')).toBeNull();
    expect(host!.querySelector('input[name="organizationName"]')).toBeNull();
    expect(host!.querySelector<HTMLInputElement>('input[name="jobTitle"]')?.required).toBe(true);
    await chooseProposalOrganization(host!, "00000000-0000-4000-8000-000000000044");
    await vi.waitFor(() => expect(selection?.missingDetails).toEqual({ organizationName: "Example Organization" }));
    expect(selection?.continuationToken).toBe("c".repeat(40));
    expect(host!.querySelector('input[name="firstName"]')).toBeNull();
    expect(host!.querySelector('input[name="organizationName"]')).toBeNull();
  });
  it("saves a signed-in proposer's corrected name, keeping the entry when the first save is refused", async () => {
    const nameRequests: unknown[] = [];
    stubAccount(signedInProposer({ identities: [proposerIdentity()] }), (url, init) => {
      if (url.pathname !== `${endpoint}/person` || init.method !== "PATCH") throw new Error("Unexpected request");
      nameRequests.push(JSON.parse(String(init.body)));
      if (nameRequests.length === 1)
        return response({ error: { code: "SAVE_REFUSED", message: "Please retry saving your name." } }, 500);
      return response({
        person: {
          email: "ada@example.test",
          firstName: "Augusta Ada",
          lastName: "Lovelace",
          organizationName: null,
          jobTitle: null,
          bio: null,
          links: [],
        },
      });
    });
    await mount();
    await chooseProposerIdentity(host!, identityId);
    await vi.waitFor(() => expect(selection?.person.firstName).toBe("Ada"));
    await clickButton(host!, "Edit my details");
    await type(document, "firstName", "Augusta");
    await clickButton(document, "Save my details");
    await vi.waitFor(() => expect(document.body.textContent).toContain("Please retry saving your name."));
    expect(document.querySelector<HTMLInputElement>('input[name="firstName"]')!.value).toBe("Augusta");
    await clickButton(document, "Save my details");
    await vi.waitFor(() => expect(host!.querySelector(".pk-datalist")?.textContent).toContain("Augusta Ada Lovelace"));
    expect(nameRequests).toHaveLength(2);
    expect(eventProposalProofPersonPatchSchema.parse(nameRequests[1])).toEqual(
      eventProposalProofPersonPatchSchema.parse(nameRequests[0]),
    );
    expect(eventProposalProofPersonPatchSchema.parse(nameRequests[0])).toEqual({
      firstName: "Augusta",
      lastName: "Lovelace",
    });
    // The saved names are the account's: the proposal sends none, and keeps the chosen identity.
    expect(selection?.person.firstName).toBe("Augusta Ada");
    expect(selection?.missingDetails).toEqual({});
    expect(selection?.actingIdentityId).toBe(identityId);
    expect(host!.querySelector('input[name="firstName"]')).toBeNull();
  });
  it("selects an owned organization identity using canonical names without duplicate profile inputs", async () => {
    const roleRequests: unknown[] = [];
    const urls = stubAccount(signedInProposer({ identities: [proposerIdentity()] }), (url, init) => {
      if (url.pathname !== `${endpoint}/identities/${identityId}`) throw new Error("Unexpected request");
      roleRequests.push(JSON.parse(String(init.body)));
      return response({
        identityId,
        organizationId: null,
        jobTitle: roleRequests.length === 1 ? "Principal Engineer" : null,
        biography: null,
        links: [],
      });
    });
    await mount();
    await chooseProposerIdentity(host!, identityId);
    expect(selection).toMatchObject({ authenticated: true, actingIdentityId: identityId });
    expect(selection?.continuationToken).toBeUndefined();
    expect(selection?.person.organizationName).toBe("Nonmember Organization");
    expect(host!.querySelector('input[name="firstName"]')).toBeNull();
    expect(host!.querySelector('input[name="organizationName"]')).toBeNull();
    expect(host!.querySelector('input[name="jobTitle"]')).toBeNull();
    expect(urls.find((url) => url.pathname.endsWith("identities"))?.searchParams.get("organizationOnly")).toBe("true");
    expect(urls.some((url) => url.pathname.startsWith(endpoint))).toBe(false);
    expect(host!.textContent).not.toContain("Your current representation is updated.");
    await clickButton(host!, "Add representation");
    const add = document.querySelector<HTMLDialogElement>("dialog[open]")!;
    expect(add.textContent).toContain(EMAIL_FIRST_COPY.representation.work.label);
    expect(add.querySelector('input[name="email"]')).not.toBeNull();
    expect(add.querySelector('[role="combobox"], input[name="organizationName"]')).toBeNull();
    await clickButton(add, "Cancel");
    await clickButton(host!, "Update current representation");
    await type(host!, "jobTitle", "Principal Engineer");
    await clickButton(host!, "Save representation");
    await vi.waitFor(() => expect(selection?.person.jobTitle).toBe("Principal Engineer"));
    expect(eventProposalProofIdentityPatchSchema.parse(roleRequests[0])).toEqual({ jobTitle: "Principal Engineer" });
    expect(host!.querySelector('[role="status"]')?.textContent).toBe("Your current representation is updated.");
    await clickButton(host!, "Update current representation");
    await type(host!, "jobTitle", "");
    await clickButton(host!, "Save representation");
    const cleared = host!.querySelector<HTMLInputElement>('input[name="jobTitle"]')!;
    expect(cleared.required).toBe(true);
    expect(cleared.getAttribute("aria-invalid")).toBe("true");
    expect(host!.textContent).toContain(JOB_TITLE_REQUIRED);
    expect(roleRequests).toHaveLength(1);
    expect(selection?.person.jobTitle).toBe("Principal Engineer");
  });
  it("holds a signed-in proposer on a representation without a job title until one is saved", async () => {
    const roleRequests: unknown[] = [];
    stubAccount(signedInProposer({ identities: [proposerIdentity({ jobTitle: null })] }), (url, init) => {
      if (url.pathname !== `${endpoint}/identities/${identityId}`) throw new Error("Unexpected request");
      roleRequests.push(JSON.parse(String(init.body)));
      return response({ identityId, organizationId: null, jobTitle: "Security Architect", biography: null, links: [] });
    });
    await mount();
    await chooseProposerIdentity(host!, identityId);
    // The representation opens for its job title; nothing is selected for the proposal yet.
    const jobTitle = host!.querySelector<HTMLInputElement>('input[name="jobTitle"]')!;
    expect(jobTitle.required).toBe(true);
    expect(selection).toBeNull();
    await clickButton(host!, "Save representation");
    expect(host!.querySelector<HTMLInputElement>('input[name="jobTitle"]')!.getAttribute("aria-invalid")).toBe("true");
    expect(roleRequests).toHaveLength(0);
    expect(selection).toBeNull();
    await type(host!, "jobTitle", "Security Architect");
    await clickButton(host!, "Save representation");
    await vi.waitFor(() => expect(selection?.person.jobTitle).toBe("Security Architect"));
    expect(eventProposalProofIdentityPatchSchema.parse(roleRequests[0])).toEqual({ jobTitle: "Security Architect" });
    expect(selection).toMatchObject({ authenticated: true, actingIdentityId: identityId });
  });
  it("asks a signed-in proposer whose account has no name for it, and sends it with the proposal", async () => {
    stubAccount(signedInProposer({ firstName: null, lastName: null, identities: [proposerIdentity()] }));
    await mount();
    await chooseProposerIdentity(host!, identityId);
    await vi.waitFor(() => expect(host!.querySelector('input[name="firstName"]')).not.toBeNull());
    expect(host!.querySelector<HTMLInputElement>('input[name="firstName"]')!.required).toBe(true);
    expect(host!.querySelector<HTMLInputElement>('input[name="lastName"]')!.required).toBe(true);
    expect(host!.querySelector('input[name="email"]')).toBeNull();
    await type(host!, "firstName", "Ada");
    await type(host!, "lastName", "Lovelace");
    expect(selection?.missingDetails).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(selection?.person).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
    expect(host!.querySelectorAll('input[name="firstName"]')).toHaveLength(1);
    // Choosing how to take part does not discard what the person typed about themselves.
    await clickButton(host!, "Choose another representation");
    await clickButton(host!, EMAIL_FIRST_COPY.proposal.individualSwitch!);
    expect(host!.querySelector<HTMLInputElement>('input[name="firstName"]')!.value).toBe("Ada");
    expect(host!.querySelector<HTMLInputElement>('input[name="lastName"]')!.value).toBe("Lovelace");
  });
  it("asks a speaker only for missing confirmed-person details and retains a claimed organization name", async () => {
    history.replaceState({}, "", `/events/2026/pqc-2026/speaker/#verify=${TOKEN}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          status: "ready",
          consents: [],
          continuationToken: "c".repeat(40),
          applicantKind: "organization",
          email: "ada@example.test",
          organization: { id: "00000000-0000-4000-8000-000000000044", name: "Example Organization", jobTitle: null },
          person: null,
        }),
      ),
    );
    await mount(true, true);
    await vi.waitFor(() => expect(host!.querySelector('input[name="firstName"]')).not.toBeNull());
    expect(host!.querySelector('input[name="organizationName"]')).toBeNull();
    expect(host!.querySelector('input[name="email"]')).toBeNull();
    await type(host!, "firstName", "Ada");
    expect(selection?.missingDetails.firstName).toBe("Ada");
    expect(host!.querySelectorAll('input[name="firstName"]')).toHaveLength(1);
    expect(host!.querySelector(".pk-datalist")?.textContent).not.toContain("Ada");
    expect(host!.querySelector("select")?.textContent).toContain("Example Organization");
    expect(host!.querySelector('[role="combobox"]')).toBeNull();
    await chooseProposalOrganization(host!, "00000000-0000-4000-8000-000000000044");
    expect(selection?.person.organizationName).toBe("Example Organization");
  });
  it("keeps a speaker's known names read-only while new affiliation drafts appear only in missing-detail inputs", async () => {
    history.replaceState({}, "", `/events/2026/pqc-2026/speaker/#verify=${TOKEN}`);
    const addRequests: unknown[] = [];
    const verifiedTokens: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (String(url) === endpoint) {
          addRequests.push(JSON.parse(init.body));
          return response({ status: "verification_sent" });
        }
        const verified = eventProposalProofVerifySchema.parse(JSON.parse(init.body));
        verifiedTokens.push(verified.token);
        const verifiedEmail = verified.token === TOKEN ? "ada@new-work.example.test" : "ada@another-work.example.test";
        return response({
          status: "ready",
          consents: [],
          continuationToken: "c".repeat(40),
          applicantKind: "organization",
          email: verifiedEmail,
          organization: null,
          person: {
            email: verifiedEmail,
            firstName: "Ada",
            lastName: "Lovelace",
            organizationName: null,
            jobTitle: null,
            bio: null,
            links: [],
          },
        });
      }),
    );
    await mount(true, true);
    await vi.waitFor(() => expect(selection?.person.firstName).toBe("Ada"));
    await type(host!, "organizationName", "New affiliation");
    await type(host!, "jobTitle", "New role");
    expect([...host!.querySelectorAll("legend")].map((legend) => legend.textContent)).toContain(
      "Your personal details",
    );
    expect([...host!.querySelectorAll("legend")].map((legend) => legend.textContent)).toContain(
      "Your representation for this proposal",
    );
    expect(host!.querySelectorAll('input[name="organizationName"]')).toHaveLength(1);
    const summary = host!.querySelector(".pk-datalist")!;
    expect(summary.textContent).toContain("Ada Lovelace");
    expect(summary.textContent).not.toContain("ada@new-work.example.test");
    expect(host!.textContent).toContain("ada@new-work.example.test");
    expect(summary.textContent).not.toContain("New affiliation");
    expect(summary.textContent).not.toContain("New role");
    expect([...summary.querySelectorAll("dt")].map((term) => term.textContent)).toEqual(["Name"]);
    expect(selection?.missingDetails).toEqual({ organizationName: "New affiliation", jobTitle: "New role" });
    expect(host!.querySelector('input[name="firstName"]')).toBeNull();
    expect(host!.querySelector('[role="combobox"]')).toBeNull();
    await clickButton(host!, "Clear unsaved changes");
    expect(host!.querySelector<HTMLInputElement>('input[name="organizationName"]')!.value).toBe("");
    expect(host!.querySelector<HTMLInputElement>('input[name="jobTitle"]')!.value).toBe("");
    expect(selection?.person.firstName).toBe("Ada");
    expect(selection?.missingDetails).toEqual({});
    expect(addRequests).toHaveLength(0);
    // Another representation is another address of theirs, confirmed under the same speaker link.
    await clickButton(host!, "Add representation");
    await type(host!, "email", "ada@another-work.example.test");
    await clickButton(host!, EMAIL_FIRST_COPY.speaker.work.action);
    await vi.waitFor(() => expect(addRequests).toHaveLength(1));
    expect(eventProposalProofStartSchema.parse(addRequests[0])).toMatchObject({
      email: "ada@another-work.example.test",
      unaffiliatedAttestation: false,
      speakerManagementToken: SPEAKER_LINK.speakerManagementToken,
    });
    expect(selection).toBeNull();
    await vi.waitFor(() => expect(host!.textContent).toContain(EMAIL_FIRST_COPY.speaker.sentTitle));
    await act(async () => {
      const changed = new Promise<void>((resolve) =>
        window.addEventListener("hashchange", () => resolve(), { once: true }),
      );
      location.hash = `verify=${"n".repeat(40)}`;
      await changed;
    });
    await vi.waitFor(() => expect(selection?.person.email).toBe("ada@another-work.example.test"));
    expect(verifiedTokens).toEqual([TOKEN, "n".repeat(40)]);
    expect(selection?.person.firstName).toBe("Ada");
    expect(host!.textContent).not.toContain(EMAIL_FIRST_COPY.speaker.sentTitle);
  });
});
