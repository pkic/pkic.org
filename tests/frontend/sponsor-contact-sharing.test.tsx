// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { render } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registrationManageSchema,
  registrationManageUpdateResponseSchema,
  registrationSponsorSharingSchema,
  type RegistrationSponsorSharing,
} from "../../assets/shared/schemas/registration";
import { mountSponsorContactSharing } from "../../assets/ts/components/SponsorContactSharing";
import { EventRegistrationManagement } from "../../assets/ts/site/EventRegistrationManagement";
import { formatDateTime } from "../../assets/ts/shared/ui";
import { confirmAction } from "../../assets/ts/components/ConfirmDialog";

vi.mock("../../assets/ts/components/ConfirmDialog", () => ({
  confirmAction: vi.fn(async () => true),
  ConfirmDialogHost: () => null,
}));

const endpoint = "/api/v1/registrations/access/synthetic-sharing-token";
const withdrawnAt = "2026-10-05T10:00:00.000Z";

async function mount(sharing: RegistrationSponsorSharing): Promise<HTMLElement> {
  document.body.innerHTML = renderToString(<EventRegistrationManagement />);
  const root = document.querySelector<HTMLElement>("[data-event-registration-manage]")!;
  await act(() => {
    mountSponsorContactSharing(root, endpoint, registrationSponsorSharingSchema.parse(sharing));
  });
  return root.querySelector<HTMLElement>("[data-sponsor-contact-sharing]")!;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function withdrawalReceipt(): Response {
  return json(
    registrationManageUpdateResponseSchema.parse({
      success: true,
      emailChanged: false,
      sponsorSharing: { allowed: false, withdrawnAt },
    }),
  );
}

afterEach(async () => {
  const host = document.querySelector<HTMLElement>("[data-sponsor-contact-sharing]");
  if (host) {
    await act(() => {
      render(null, host);
    });
  }
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.mocked(confirmAction).mockReset();
  vi.mocked(confirmAction).mockResolvedValue(true);
});

describe("attendee sponsor contact sharing", () => {
  it.each([
    [{ allowed: false, withdrawnAt: null }, "Not sharing"],
    [{ allowed: false, withdrawnAt }, "Sharing withdrawn"],
    [{ allowed: true, withdrawnAt }, "Sharing enabled"],
  ] as const)(
    "shows canonical current sharing state without an acceptance or regrant control",
    async (sharing, label) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const host = await mount(sharing);
      expect(host.textContent).toContain(label);
      if (!sharing.allowed && sharing.withdrawnAt) {
        expect(host.textContent).toContain(formatDateTime(sharing.withdrawnAt));
      }
      if (sharing.allowed) {
        expect(host.querySelector("button")?.textContent).toBe("Withdraw sharing…");
        expect([...host.querySelectorAll("dt")].map((term) => term.textContent)).not.toContain("Withdrawn");
        if (sharing.withdrawnAt) expect(host.textContent).not.toContain(formatDateTime(sharing.withdrawnAt));
      } else {
        expect(host.querySelector("button")).toBeNull();
      }
      expect(host.querySelector("input")).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("withdraws through the own registration capability and changes status only after its receipt", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const host = await mount({ allowed: true, withdrawnAt: null });
    const button = host.querySelector<HTMLButtonElement>("button")!;
    expect(button.type).toBe("button");
    // Withdrawing takes effect at once, so it sits in the page's read view
    // rather than inside the details form that waits for "Edit details".
    expect(host.querySelector("form")).toBeNull();
    expect(host.closest("form")).toBeNull();
    expect(host.closest("[data-manage-form]")).not.toBeNull();
    expect(host.textContent).toContain("already downloaded cannot be recalled");
    expect(button.classList.contains("pk-btn--danger-quiet")).toBe(true);
    await act(async () => {
      button.click();
    });
    expect(confirmAction).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmLabel: "Withdraw sharing",
        tone: "danger",
        consequences: expect.arrayContaining(["Copies sponsors have already downloaded cannot be recalled"]),
      }),
    );
    expect(host.textContent).toContain("Sharing enabled");
    expect(button.getAttribute("aria-busy")).toBe("true");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(endpoint);
    expect(init?.method).toBe("PATCH");
    const command = registrationManageSchema.parse(JSON.parse(String(init?.body)));
    expect(command.action).toBe("withdraw_sponsor_sharing");
    expect(Object.keys(command)).toEqual(["action"]);
    await act(async () => {
      resolve(withdrawalReceipt());
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Sharing withdrawn"));
    expect(host.textContent).toContain(formatDateTime(withdrawnAt));
    expect(host.querySelector("button")).toBeNull();
  });

  it("keeps sharing and sends nothing when the withdrawal is not confirmed", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.mocked(confirmAction).mockResolvedValue(false);
    const host = await mount({ allowed: true, withdrawnAt: null });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Sharing enabled");
    expect(host.querySelector("button")?.getAttribute("aria-busy")).toBeNull();
  });

  it("retains sharing on a refusal and permits an explicit retry", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { code: "FORBIDDEN", message: "This link cannot change sharing." } }, 403))
      .mockResolvedValueOnce(withdrawalReceipt());
    vi.stubGlobal("fetch", fetch);
    const host = await mount({ allowed: true, withdrawnAt: null });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    await vi.waitFor(() =>
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("cannot change sharing"),
    );
    expect(host.textContent).toContain("Sharing enabled");
    expect(host.textContent).not.toContain("Sharing withdrawn");
    const retry = host.querySelector<HTMLButtonElement>("button")!;
    expect(retry.getAttribute("aria-busy")).toBeNull();
    await act(async () => {
      retry.click();
    });
    await vi.waitFor(() => expect(host.textContent).toContain("Sharing withdrawn"));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("refuses a success payload without canonical sharing state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ success: true, emailChanged: false })));
    const host = await mount({ allowed: true, withdrawnAt: null });
    await act(async () => {
      host.querySelector<HTMLButtonElement>("button")!.click();
    });
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')).not.toBeNull());
    expect(host.textContent).toContain("Sharing enabled");
    expect(host.textContent).not.toContain("Sharing withdrawn");
    expect(host.querySelector("button")?.textContent).toBe("Withdraw sharing…");
  });
});
