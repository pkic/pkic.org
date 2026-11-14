// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventProposalProofStartSchema } from "../../assets/shared/schemas/event-proposal-proof";
import {
  ADDRESS_IN_USE_COPY,
  EMAIL_FIRST_ADVISORY_COPY,
  EMAIL_FIRST_COPY,
  WORK_EMAIL_STEER,
} from "../../assets/shared/email-first-copy";
import type { ProposalEntrySelection } from "../../assets/ts/components/useProposalEntryIdentity";
import { completeIndependentCapacityDisclosure } from "./helpers/independent-capacity";
import { radioNamed } from "./helpers/labeled-control";
import {
  mountProposalIdentityStep,
  signedInProposer,
  signedOutResponse as signedOut,
  SPEAKER_LINK,
} from "./helpers/proposal-identity-fixture";

const endpoint = "/api/v1/events/pqc-2026/proposals/proof";
let host: HTMLDivElement | undefined;
let selection: ProposalEntrySelection | null = null;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
/**
 * Mounts the step for a signed-in proposer, or, with `speaker`, for a speaker on their own link: only a
 * speaker confirms a mailbox here, so the email step is reached through one.
 */
async function mount(respond: (path: string, init?: RequestInit) => Response, speaker = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(new URL(String(input), location.origin).pathname, init),
    ),
  );
  host = await mountProposalIdentityStep({
    enabled: true,
    onChange: (value) => {
      selection = value;
    },
    ...(speaker ? SPEAKER_LINK : {}),
  });
  const copy = EMAIL_FIRST_COPY[speaker ? "speaker" : "proposal"];
  await vi.waitFor(() =>
    expect(host!.textContent).toMatch(new RegExp(`${copy.personal.title}|${copy.individualSwitch}`)),
  );
}
const copy = EMAIL_FIRST_COPY.speaker;
async function enterEmail(value: string) {
  await act(() => {
    const email = host!.querySelector<HTMLInputElement>('input[name="email"]')!;
    email.value = value;
    email.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  await act(async () => {
    Array.from(host!.querySelectorAll("button"))
      .find((button) => button.textContent === label)!
      .click();
  });
}
afterEach(() => {
  if (host) render(null, host);
  document.body.innerHTML = "";
  host = undefined;
  selection = null;
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("proposal and speaker contact capacity", () => {
  it("starts with the work email and steers a consumer mailbox, then continues it on the personal card", async () => {
    const sent: unknown[] = [];
    await mount((path, init) => {
      if (path !== endpoint) return signedOut();
      const body = eventProposalProofStartSchema.parse(JSON.parse(String(init?.body)));
      // The server knows gmail.com is free mail and refuses it for an organization through the validation envelope.
      if (!body.unaffiliatedAttestation)
        return response(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid request",
              details: { formErrors: [], fieldErrors: { email: [WORK_EMAIL_STEER] } },
            },
          },
          400,
        );
      sent.push(body);
      return response({ status: "verification_sent" });
    }, true);
    expect(host!.textContent).toContain(copy.work.label);
    expect(host!.querySelector('input[name="applicantKind"]')).toBeNull();
    await enterEmail("speaker@gmail.com");
    await click(copy.work.action);
    expect(sent).toHaveLength(0);
    await vi.waitFor(() => expect(host!.textContent).toContain(WORK_EMAIL_STEER));
    await click(EMAIL_FIRST_ADVISORY_COPY.usePersonal);
    expect(radioNamed(host!, copy.personal.title).checked).toBe(true);
    await click(copy.personal.action);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const individual = eventProposalProofStartSchema.parse(sent[0]);
    expect(individual).toMatchObject({ email: "speaker@gmail.com", unaffiliatedAttestation: true });
    await vi.waitFor(() => expect(host!.textContent).toContain(copy.sent("speaker@gmail.com")));
  });

  it("sends a work address on behalf of the organization with the terms accepted before the email step", async () => {
    const sent: unknown[] = [];
    await mount((path, init) => {
      if (path === endpoint) sent.push(JSON.parse(String(init?.body)));
      return path === endpoint ? response({ status: "verification_sent" }) : signedOut();
    }, true);
    await enterEmail("speaker@official.example");
    await click(copy.work.action);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(eventProposalProofStartSchema.parse(sent[0])).toMatchObject({
      email: "speaker@official.example",
      unaffiliatedAttestation: false,
      speakerManagementToken: SPEAKER_LINK.speakerManagementToken,
      consents: [{ termKey: "speaker-agreement", version: "1" }],
    });
  });

  it("lets a signed-in person submit as an individual with their own details and no email step", async () => {
    const account = signedInProposer({ email: "speaker@gmail.com", firstName: "Personal", lastName: "Speaker" });
    await mount((path) => account(path) ?? response({ error: { code: "NOT_FOUND", message: "Not found" } }, 404));
    expect(host!.querySelector('input[name="email"]')).toBeNull();
    await click(EMAIL_FIRST_COPY.proposal.individualSwitch!);
    await completeIndependentCapacityDisclosure(host!);
    await vi.waitFor(() => expect(selection).not.toBeNull());
    expect(selection).toMatchObject({
      authenticated: true,
      actingIdentityId: null,
      unaffiliatedAttestation: true,
      independentCapacity: { organizationConnection: "no", currentPosition: "Independent consultant" },
    });
  });

  it("tells a speaker to sign in with a confirmed work address that belongs to another account", async () => {
    history.replaceState({}, "", `/events/2026/pqc-2026/speaker/#verify=${"v".repeat(40)}`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ status: "sign_in_required", email: "speaker@official.example" })),
    );
    host = await mountProposalIdentityStep({
      enabled: true,
      onChange: (value) => {
        selection = value;
      },
      ...SPEAKER_LINK,
    });
    await vi.waitFor(() => expect(host!.textContent).toContain(ADDRESS_IN_USE_COPY.title));
    expect(host!.textContent).toContain(ADDRESS_IN_USE_COPY.body("speaker@official.example"));
    expect(host!.querySelector<HTMLAnchorElement>('a[href="/portal/"]')).not.toBeNull();
    expect(selection).toBeNull();
  });
});
