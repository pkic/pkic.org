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
 * The contact step decides between a saved profile and the email form only once it knows who is signed
 * in. Until then it shows that it is loading, so nothing typed lands in a form that is about to be replaced.
 */
describe("event entry contact step", () => {
  it("shows the loading state from the first render, so an email is never typed into a form that resets", async () => {
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
    expect(host.textContent).toContain("Loading your details");
    expect(host.querySelector('input[name="email"]')).toBeNull();
    // Still loading while the session probe is out.
    await vi.waitFor(() => expect(answerSession).toBeDefined());
    expect(host.textContent).toContain("Loading your details");
    await act(async () => {
      answerSession!(response({ error: { code: "UNAUTHORIZED", message: "Sign in" } }, 401));
    });
    await vi.waitFor(() => expect(host!.querySelector('input[name="email"]')).not.toBeNull());
    await act(() => {
      const email = host!.querySelector<HTMLInputElement>('input[name="email"]')!;
      email.value = "ada@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector<HTMLInputElement>('input[name="email"]')!.value).toBe("ada@example.test");
  });
});
