// @vitest-environment jsdom
/**
 * The join page's first step for a visitor: the shared sign-in card, embedded.
 * Joining proves no address of its own any more, so what matters here is that
 * the card is the same one the portal uses, that its links bring the person
 * back to this page with their query intact, and that nothing of the
 * application is shown or asked before they are signed in.
 */
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAIL_FIRST_COPY } from "../../assets/shared/email-first-copy";
import { userAuthRequestSchema } from "../../assets/shared/schemas/user-auth";
import { openJoinPage } from "./helpers/join-page";

vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: () => true }));

function button(text: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === text);
  expect(found, `no button reading "${text}"`).toBeTruthy();
  return found!;
}

afterEach(() => {
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.unstubAllGlobals();
  vi.resetModules();
  history.replaceState({}, "", "/");
});

describe("joining without a session", () => {
  it("starts with the shared sign-in card and shows nothing of the application", async () => {
    history.replaceState({}, "", "/join/?category=A");
    const requests = openJoinPage(null, () => Response.json({ success: true }));
    await import("../../assets/ts/member-flows/join-form");

    const card = document.querySelector<HTMLElement>("[data-join-sign-in-card]")!;
    await vi.waitFor(() => expect(card.querySelector("button")).not.toBeNull());
    expect(document.querySelector<HTMLElement>("[data-join-sign-in]")?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>("[data-join-signed-in]")?.hidden).toBe(true);
    expect(document.querySelector<HTMLFormElement>("[data-join-application-form]")?.hidden).toBe(true);
    // The three ways in of the one card: a passkey, an email link, and starting an account.
    button("Sign in with a passkey");
    button("Sign in with an email link");
    expect(card.textContent).toContain("New here?");
    // The card words itself for joining, not as a bare sign-in.
    expect(card.querySelector("h1, h2")?.textContent).toBe("Join the PKI Consortium");
    // The page already says what it is; the embedded card brings no brand panel of its own.
    expect(card.querySelector(".pk-login__brand")).toBeNull();
    // Nothing is asked about a membership path before someone is signed in.
    expect(requests).toEqual([]);

    // An email link returns to this page, query included.
    await act(async () => button("Sign in with an email link").click());
    const email = card.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
      email.value = "ada@example-corp.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      button("Send sign-in link").click();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.path).toBe("/api/v1/auth/request-link");
    expect(userAuthRequestSchema.parse(requests[0]!.body)).toEqual({
      email: "ada@example-corp.test",
      returnPath: "/join/?category=A",
    });
  });

  it("starts a new account with the membership wording for a work or personal address", async () => {
    openJoinPage(null);
    await import("../../assets/ts/member-flows/join-form");
    const card = document.querySelector<HTMLElement>("[data-join-sign-in-card]")!;
    await vi.waitFor(() => expect(card.querySelector("button")).not.toBeNull());
    await act(async () => button("Start your application").click());
    expect(card.textContent).toContain(EMAIL_FIRST_COPY.join.work.label);
    expect(card.textContent).toContain(EMAIL_FIRST_COPY.join.personal.description);
  });
});
