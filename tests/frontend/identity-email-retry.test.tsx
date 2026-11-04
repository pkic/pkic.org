// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VerifiedOrganizationCreateDialog } from "../../assets/ts/components/identities/VerifiedOrganizationCreateDialog";
import { SelfIdentityCreateForm } from "../../assets/ts/components/identities/SelfIdentityCreateForm";
import { ownRepresentationEmailAddSchema } from "../../assets/shared/schemas/own-email-addresses";
import { controlFor } from "./helpers/labeled-control";

let host: HTMLDivElement;
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
});

describe("shared identity mailbox retry", () => {
  it.each([202, 429])(
    "requests a new verification for an existing pending address and handles HTTP %s",
    async (status) => {
      const emailId = "00000000-0000-4000-8000-000000000081";
      const requests: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input, init) => {
          const path = String(input).split("?")[0];
          if (init?.method === "POST") {
            const parsed = ownRepresentationEmailAddSchema.parse(JSON.parse(String(init?.body)));
            expect(parsed.email).toBe("person@work.example");
            requests.push(path);
            return new Response(
              JSON.stringify(
                status === 202
                  ? { status: "verification_sent", email: "person@work.example", requestId: emailId, delivery: "sent" }
                  : { error: { code: "RATE_LIMITED", message: "Please wait before requesting another link." } },
              ),
              { status, headers: { "content-type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              emails: [
                {
                  id: emailId,
                  email: "person@work.example",
                  primary: false,
                  verifiedAt: null,
                  verificationMethod: null,
                  identityId: null,
                  signInEnabled: false,
                  createdAt: "2026-10-26T00:00:00.000Z",
                },
              ],
              page: { limit: 20, offset: 0, total: 1, hasMore: false },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }),
      );
      host = document.createElement("div");
      document.body.append(host);
      await act(() => render(<SelfIdentityCreateForm onCreated={vi.fn()} />, host));
      const email = controlFor(host, "Your work email address") as HTMLInputElement;
      await act(() => {
        email.value = "person@work.example";
        email.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      await vi.waitFor(() =>
        status === 202
          ? expect(host.textContent).toContain("Open the verification email")
          : expect(host.querySelector('[role="alert"]')?.textContent).toContain("Please wait"),
      );
      expect(Boolean(host.querySelector('input[name="email"]'))).toBe(status !== 202);
    },
  );
});

describe("verified organization domain selection", () => {
  it("ignores a response from before the dialog was closed and reopened", async () => {
    const initial = {
      email: "person@work.example",
      domain: "work.example",
      domains: [
        { domain: "work.example", canLink: false, organizationName: null },
        { domain: "sub.work.example", canLink: true, organizationName: null },
      ],
      organization: null,
      organizations: [],
    };
    const pending: Array<(value: typeof initial) => void> = [];
    const resolve = vi.fn(() => new Promise<typeof initial>((finish) => pending.push(finish)));
    const props = { initial, resolve, onUse: vi.fn(), onClose: vi.fn() };
    host = document.createElement("div");
    document.body.append(host);
    await act(() => render(<VerifiedOrganizationCreateDialog {...props} open />, host));
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    await act(() => render(<VerifiedOrganizationCreateDialog {...props} open={false} />, host));
    await act(() => render(<VerifiedOrganizationCreateDialog {...props} open />, host));
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[0]!({ ...initial, domain: "sub.work.example" }));
    expect((controlFor(host, "Email domain") as HTMLSelectElement).value).toBe("work.example");
    await act(async () => pending[1]!({ ...initial, domain: "sub.work.example" }));
    await vi.waitFor(() =>
      expect((controlFor(host, "Email domain") as HTMLSelectElement).value).toBe("sub.work.example"),
    );
  });
});
