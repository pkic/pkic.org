// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventProposalIdentityStep } from "../../assets/ts/components/EventProposalIdentityStep";
import {
  ORGANIZATION_WORK_EMAIL_REQUIRED,
  eventProposalProofStartSchema,
} from "../../assets/shared/schemas/event-proposal-proof";
import type { ProposalEntrySelection } from "../../assets/ts/components/useProposalEntryIdentity";

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
  await vi.waitFor(() => expect(host!.querySelector('input[value="organization"]')).not.toBeNull());
}
async function choose(kind: "organization" | "individual") {
  await act(() => {
    const option = host!.querySelector<HTMLInputElement>(`input[value="${kind}"]`)!;
    option.checked = true;
    option.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
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
  it("asks in what capacity the proposal is submitted and explains what an individual arranges", async () => {
    await mount(signedOut);
    expect(host!.querySelector("legend")?.textContent).toContain("In what capacity are you submitting this proposal?");
    expect(host!.textContent).not.toContain("employed");
    await choose("individual");
    expect(host!.textContent).toContain("Individual speakers usually arrange and pay for their own travel");
    expect(host!.querySelector('input[name="unaffiliatedAttestation"]')).toBeNull();
    await choose("organization");
    expect(host!.textContent).not.toContain("Individual speakers usually arrange");
    expect(host!.textContent).toContain("Work email address");
  });

  it("refuses a personal address on behalf of an organization without sending a verification", async () => {
    const sent: unknown[] = [];
    await mount((path, init) => {
      if (path === endpoint) sent.push(JSON.parse(String(init?.body)));
      return path === endpoint ? response({ status: "verification_sent" }) : signedOut();
    });
    await choose("organization");
    await enterEmail("speaker@gmail.com");
    await click("Verify work email");
    expect(sent).toHaveLength(0);
    const email = host!.querySelector<HTMLInputElement>('input[name="email"]')!;
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(host!.textContent).toContain(ORGANIZATION_WORK_EMAIL_REQUIRED);
    await choose("individual");
    await enterEmail("speaker@gmail.com");
    await click("Verify email");
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const individual = eventProposalProofStartSchema.parse(sent[0]);
    expect(individual).toMatchObject({ email: "speaker@gmail.com", unaffiliatedAttestation: true });
  });

  it("lets a signed-in person submit as an individual with their own account and no email step", async () => {
    await mount(signedIn);
    await choose("individual");
    await vi.waitFor(() => expect(selection).not.toBeNull());
    expect(selection).toMatchObject({ authenticated: true, actingIdentityId: null, unaffiliatedAttestation: true });
    expect(host!.querySelector('input[name="email"]')).toBeNull();
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
    await vi.waitFor(() => expect(host!.textContent).toContain("This address belongs to another account"));
    expect(host!.textContent).toContain("Sign in with speaker@official.example");
    expect(host!.textContent).toContain("the secretariat can merge them");
    expect(host!.querySelector<HTMLAnchorElement>('a[href="/portal/"]')?.textContent).toBe("Sign in");
    expect(selection).toBeNull();
  });
});
