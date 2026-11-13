// @vitest-environment jsdom
/**
 * A proposer's first step when nobody is signed in: the shared sign-in card,
 * in place. No mailbox is confirmed on this page any more, so nothing here may
 * reach the speaker proof endpoint, and every link the card sends returns the
 * person to the page they were on.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { userAuthRequestSchema, userSignUpRequestSchema } from "../../assets/shared/schemas/user-auth";
import { EventProposalIdentityStep } from "../../assets/ts/components/EventProposalIdentityStep";
import type { ProposalEntrySelection } from "../../assets/ts/components/useProposalEntryIdentity";
import { completeIndependentCapacityDisclosure } from "./helpers/independent-capacity";
import { buttonNamed, controlFor, typeInto } from "./helpers/labeled-control";
import { signedInProposer, signedOutResponse } from "./helpers/proposal-identity-fixture";

const authenticateWithPasskey = vi.fn<() => Promise<unknown>>();
const browserSupportsWebAuthn = vi.fn<() => boolean>();
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => browserSupportsWebAuthn(),
}));
vi.mock("../../assets/ts/shared/passkey-authentication", () => ({
  authenticateWithPasskey: () => authenticateWithPasskey(),
}));

const INVITE_ID = "0b7e9d1c-5a4f-4c2e-9f3a-2d6b8e1c4a70";
const PAGE = `/events/2026/pqc-2026/propose/?invite=abc12345&id=${INVITE_ID}&source=newsletter`;
// The emailed link returns here with the invitation id; its token stays in this browser.
const RETURN_PATH = `/events/2026/pqc-2026/propose/?id=${INVITE_ID}&source=newsletter`;
const copy = EMAIL_FIRST_COPY.proposal;

interface Captured {
  path: string;
  body: unknown;
}

let pageForm: HTMLFormElement;
let host: HTMLDivElement;
let selection: ProposalEntrySelection | null = null;
let pageSubmits = 0;

/** Answers the session read through `session`, accepts every other request, and records what was sent. */
function installApi(session: (path: string) => Response | undefined): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), location.origin).pathname;
      requests.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      return session(path) ?? Response.json({ success: true });
    }),
  );
  return requests;
}

const signedOut = (path: string) => (path === "/api/v1/auth/session" ? signedOutResponse() : undefined);

/** The step where the page puts it: inside the proposal form, which must never be submitted from the card. */
async function mount(): Promise<void> {
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
      host,
    ),
  );
}

function signInCard(): HTMLElement | null {
  return host.querySelector<HTMLElement>('section[aria-label="Sign in"]');
}

async function shownSignInCard(): Promise<HTMLElement> {
  await vi.waitFor(() => expect(signInCard()).not.toBeNull());
  return signInCard()!;
}

beforeEach(() => {
  history.replaceState({}, "", PAGE);
  pageForm = document.createElement("form");
  host = document.createElement("div");
  pageForm.append(host);
  document.body.append(pageForm);
  pageSubmits = 0;
  pageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    pageSubmits += 1;
  });
  browserSupportsWebAuthn.mockReturnValue(true);
  authenticateWithPasskey.mockReset();
});

afterEach(async () => {
  await act(() => render(null, host));
  document.body.innerHTML = "";
  selection = null;
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("proposal sign-in step", () => {
  it("shows the sign-in card to a signed-out proposer and confirms no mailbox, even from a confirmation link", async () => {
    history.replaceState({}, "", `${PAGE}#verify=${"v".repeat(40)}`);
    const requests = installApi(signedOut);
    await mount();
    const card = await shownSignInCard();

    expect([...card.querySelectorAll("button")].some((button) => /passkey/i.test(button.textContent ?? ""))).toBe(true);
    expect([...card.querySelectorAll("button")].some((button) => /email link/i.test(button.textContent ?? ""))).toBe(
      true,
    );
    expect([...card.querySelectorAll("h3")].some((heading) => /new here/i.test(heading.textContent ?? ""))).toBe(true);
    // The work-or-personal email step belongs to starting an account, not to the first view.
    expect(host.querySelector('input[type="radio"]')).toBeNull();
    expect(host.querySelector('input[name="email"]')).toBeNull();
    expect(selection).toBeNull();
    expect(requests.map(({ path }) => path)).toEqual(["/api/v1/auth/session"]);
  });

  it("requests an email link that returns to this page, without submitting the proposal form around it", async () => {
    const requests = installApi(signedOut);
    await mount();
    const card = await shownSignInCard();
    await act(() => {
      [...card.querySelectorAll("button")].find((button) => /email link/i.test(button.textContent ?? ""))!.click();
    });
    await typeInto(controlFor(card, "Email"), "ada@example.test");
    await act(async () => {
      [...card.querySelectorAll("button")]
        .find((button) => /send sign-in link/i.test(button.textContent ?? ""))!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(requests.some(({ path }) => path === "/api/v1/auth/request-link")).toBe(true));

    const sent = requests.filter(({ path }) => path === "/api/v1/auth/request-link");
    expect(sent).toHaveLength(1);
    expect(userAuthRequestSchema.parse(sent[0].body)).toEqual({ email: "ada@example.test", returnPath: RETURN_PATH });
    await vi.waitFor(() => expect(card.querySelector('[role="status"]')).not.toBeNull());
    expect(pageSubmits).toBe(0);
    expect(requests.some(({ path }) => path.includes("/proposals/proof"))).toBe(false);
  });

  it("starts an account from the card with a link that returns to this page", async () => {
    const requests = installApi(signedOut);
    await mount();
    const card = await shownSignInCard();
    await act(() => buttonNamed(card, "Start your proposal").click());
    await typeInto(controlFor(card, copy.work.label), "ada@organization.example");
    await act(async () => {
      buttonNamed(card, copy.work.action).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await vi.waitFor(() => expect(requests.some(({ path }) => path === "/api/v1/auth/sign-up")).toBe(true));

    const sent = requests.filter(({ path }) => path === "/api/v1/auth/sign-up");
    expect(sent).toHaveLength(1);
    expect(userSignUpRequestSchema.parse(sent[0].body)).toEqual({
      email: "ada@organization.example",
      unaffiliatedAttestation: false,
      returnPath: RETURN_PATH,
    });
    await vi.waitFor(() => expect(card.textContent).toContain(copy.sent("ada@organization.example")));
    expect(pageSubmits).toBe(0);
    expect(requests.some(({ path }) => path.includes("/proposals/proof"))).toBe(false);
    expect(selection).toBeNull();
  });

  it("replaces the card with the signed-in step once a passkey signs the person in", async () => {
    let signedIn = false;
    const account = signedInProposer();
    const requests = installApi((path) => (signedIn ? account(path) : signedOut(path)));
    authenticateWithPasskey.mockImplementation(async () => {
      signedIn = true;
    });
    await mount();
    const card = await shownSignInCard();
    await act(async () => {
      [...card.querySelectorAll("button")].find((button) => /passkey/i.test(button.textContent ?? ""))!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await vi.waitFor(() => expect(host.querySelector('[role="combobox"]')).not.toBeNull());
    expect(authenticateWithPasskey).toHaveBeenCalledTimes(1);
    expect(signInCard()).toBeNull();
    expect(requests.filter(({ path }) => path === "/api/v1/auth/session")).toHaveLength(2);

    await act(() => buttonNamed(host, copy.individualSwitch!).click());
    await completeIndependentCapacityDisclosure(host);
    await vi.waitFor(() => expect(selection).not.toBeNull());
    expect(selection).toMatchObject({ authenticated: true, actingIdentityId: null, unaffiliatedAttestation: true });
    expect(selection?.continuationToken).toBeUndefined();
    expect(selection?.person).toMatchObject({ email: "ada@example.test", firstName: "Ada", lastName: "Lovelace" });
    expect(pageSubmits).toBe(0);
    expect(requests.some(({ path }) => path.includes("/proposals/proof"))).toBe(false);
  });
});
