// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventProposalIdentityStep } from "../../assets/ts/components/EventProposalIdentityStep";

let host: HTMLDivElement | undefined;
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
afterEach(() => {
  if (host) render(null, host);
  document.body.innerHTML = "";
  host = undefined;
  vi.unstubAllGlobals();
});

/**
 * The contact step decides between the signed-in person's details and the sign-in card only once it
 * knows who is signed in. Until then it shows that it is loading, so nothing typed lands in a card that
 * is about to be replaced.
 */
describe("event entry contact step", () => {
  it("shows the loading state from the first render, and the sign-in card only once the session has answered", async () => {
    let answerSession: ((value: Response) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("auth/session")) return new Promise<Response>((resolve) => (answerSession = resolve));
        throw new Error("Unexpected request");
      }),
    );
    host = document.createElement("div");
    document.body.append(host);
    // The first paint, before any effect asks who is signed in.
    render(
      <EventProposalIdentityStep enabled eventSlug="pqc-2026" consents={() => []} onChange={() => undefined} />,
      host,
    );
    const loading = () => host!.querySelector('[role="status"]');
    const signIn = () => host!.querySelector('section[aria-label="Sign in"]');
    expect(loading()).not.toBeNull();
    expect(signIn()).toBeNull();
    expect(host.querySelector("input")).toBeNull();
    // Still loading while the session probe is out.
    await vi.waitFor(() => expect(answerSession).toBeDefined());
    expect(loading()).not.toBeNull();
    expect(signIn()).toBeNull();
    await act(async () => {
      answerSession!(response({ error: { code: "UNAUTHORIZED", message: "Sign in" } }, 401));
    });
    await vi.waitFor(() => expect(signIn()).not.toBeNull());
    expect(loading()).toBeNull();
  });
});
