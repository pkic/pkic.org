// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventProposalIdentityStep } from "../../assets/ts/components/EventProposalIdentityStep";
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

const endpoint = "/api/v1/events/pqc-2026/proposals/proof";
const userId = "00000000-0000-4000-8000-000000000041";
let host: HTMLDivElement | undefined;
let selection: ProposalEntrySelection | null = null;

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
const signedOut = () => response({ error: { code: "AUTH_INVALID", message: "Invalid user session token" } }, 401);
function signedIn(path: string) {
  if (path === "/api/v1/auth/session")
    return response({
      success: true,
      sessionId: "00000000-0000-4000-8000-000000000096",
      identity: { id: userId, email: "speaker@gmail.com" },
      eventParticipation: true,
      expiresAt: "2099-12-31T23:59:59.000Z",
      idleExpiresAt: "2099-12-31T23:59:59.000Z",
    });
  const now = "2026-01-01T00:00:00.000Z";
  return response({
    user: {
      id: userId,
      email: "speaker@gmail.com",
      first_name: "Personal",
      last_name: "Speaker",
      preferred_name: null,
      active: true,
      isEcMember: false,
      created_at: now,
      updated_at: now,
      pii_redacted_at: null,
      headshotUrl: null,
      identities: [],
      formerIdentities: [],
    },
  });
}
async function mount(respond: (path: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      respond(new URL(String(input), location.origin).pathname, init),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  await act(() =>
    render(
      <EventProposalIdentityStep
        enabled
        eventSlug="pqc-2026"
        consents={() => [{ termKey: "speaker-agreement", version: "1" }]}
        onChange={(value) => {
          selection = value;
        }}
      />,
      host!,
    ),
  );
  await vi.waitFor(() =>
    expect(host!.textContent).toMatch(new RegExp(`${copy.personal.title}|${copy.individualSwitch}`)),
  );
}
const copy = EMAIL_FIRST_COPY.proposal;
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

describe("proposal contact capacity", () => {
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
    });
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
    });
    await enterEmail("speaker@official.example");
    await click(copy.work.action);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(eventProposalProofStartSchema.parse(sent[0])).toMatchObject({
      email: "speaker@official.example",
      unaffiliatedAttestation: false,
      consents: [{ termKey: "speaker-agreement", version: "1" }],
    });
  });

  it("lets a signed-in person submit as an individual with their own details and no email step", async () => {
    await mount(signedIn);
    expect(host!.querySelector('input[name="email"]')).toBeNull();
    await click(copy.individualSwitch!);
    await completeIndependentCapacityDisclosure(host!);
    await vi.waitFor(() => expect(selection).not.toBeNull());
    expect(selection).toMatchObject({
      authenticated: true,
      actingIdentityId: null,
      unaffiliatedAttestation: true,
      independentCapacity: { organizationConnection: "no", currentPosition: "Independent consultant" },
    });
  });

  it("tells a person to sign in with a verified work address that belongs to another account", async () => {
    history.replaceState({}, "", `/events/2026/pqc-2026/proposal/#verify=${"v".repeat(40)}`);
    await act(async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response({ status: "sign_in_required", email: "speaker@official.example" })),
      );
      host = document.createElement("div");
      document.body.append(host);
      render(
        <EventProposalIdentityStep
          enabled
          eventSlug="pqc-2026"
          consents={() => []}
          onChange={(value) => {
            selection = value;
          }}
        />,
        host,
      );
    });
    await vi.waitFor(() => expect(host!.textContent).toContain(ADDRESS_IN_USE_COPY.title));
    expect(host!.textContent).toContain(ADDRESS_IN_USE_COPY.body("speaker@official.example"));
    expect(host!.querySelector<HTMLAnchorElement>('a[href="/portal/"]')?.textContent).toBe("Sign in");
    expect(selection).toBeNull();
  });
});
