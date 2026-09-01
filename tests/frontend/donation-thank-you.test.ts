// @vitest-environment jsdom
/**
 * The donation thank-you badge.
 *
 * The polling cases assert the network contract; the rest assert what the
 * surface exposes — the live region that carries the "confirming" wait, the
 * `for`/`id` pair naming the personal share link, the copy outcome reported
 * separately from the button's own name, and the `role="alert"` outcomes for
 * a payment that failed or a checkout that expired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { donationPromoterRequestSchema } from "../../assets/shared/schemas/donation";

const SESSION_PATH = "/api/v1/donations/session";
const PROMOTER_PATH = "/api/v1/donations/promoters";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const CONFIRMED = {
  grossAmount: 5000,
  currency: "usd",
  donorFirstName: "Alice",
  source: null,
  completedAt: "2026-04-10T10:00:00Z",
};

const PROMOTER = {
  code: "abc123",
  shareUrl: "https://pkic.org/donate/r/abc123",
  ogImageUrl: "https://pkic.org/images/donation-badge.png",
};

/** The control a `Field` label names, resolved through its own `for`/`id` pair. */
function controlFor(root: ParentNode, label: string): HTMLInputElement {
  const match = [...root.querySelectorAll("label")].find(
    (candidate) => (candidate.textContent ?? "").replace(/\*?\(required\)$/, "").trim() === label,
  );
  if (!match) throw new Error(`no label reads "${label}"`);
  const control = root.querySelector<HTMLInputElement>(`[id="${match.htmlFor}"]`);
  if (!control) throw new Error(`label "${label}" points at no control`);
  return control;
}

function badgeContainer(): HTMLElement {
  const container = document.querySelector<HTMLElement>("[data-donation-badge]");
  if (!container) throw new Error("no badge container");
  return container;
}

/** A confirmed session followed by a promoter code, which is the happy path. */
function stubConfirmedDonation(promoter: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`${SESSION_PATH}?session_id=`)) return json(CONFIRMED);
      if (url.includes(PROMOTER_PATH)) return promoter();
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

/** Installs a clipboard the copy control can reach; returns its removal. */
function installClipboard(writeText: () => Promise<void>): () => void {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return () => Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, "clipboard");
}

async function loadModule(): Promise<void> {
  await import("../../assets/ts/shared/donation/thank-you");
  await vi.runAllTimersAsync();
}

describe("donation thank-you page", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    document.body.innerHTML = `
      <div data-donation-badge hidden></div>
      <div data-donation-pending-content hidden><p>Pending confirmation.</p></div>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = "";
  });

  it("does not call the promoter endpoint while the donation remains pending", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_pending_frontend");

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`${SESSION_PATH}?session_id=`)) {
        return json({ pending: true }, 202);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadModule();

    expect(fetchMock).toHaveBeenCalled();
    expect(fetchMock.mock.calls.every(([input]) => String(input).includes(`${SESSION_PATH}?session_id=`))).toBe(true);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes(PROMOTER_PATH))).toBe(false);
    expect(
      fetchMock.mock.calls.some((call) => {
        const [, init] = call as unknown as [RequestInfo | URL, RequestInit | undefined];
        return (init?.method ?? "GET").toUpperCase() !== "GET";
      }),
    ).toBe(false);
  });

  it("shows bank-transfer pending message and continues polling until confirmed", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_async_frontend");

    let callCount = 0;
    // Every call returns asyncPayment:true, simulating a payment that has not
    // settled within the test window.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`${SESSION_PATH}?session_id=`)) {
        callCount++;
        return json({ pending: true, asyncPayment: true }, 202);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadModule();

    expect(callCount).toBeGreaterThan(1);
    // Promoter endpoint must not be called (no confirmed payment)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes(PROMOTER_PATH))).toBe(false);

    const container = badgeContainer();
    expect(container.hidden).toBe(false);
    expect(container.textContent).toContain("being processed");
    // An outcome the reader did not ask for still has to reach them, so it is
    // a live region rather than a coloured box that silently appears.
    expect(container.querySelector("[role='status']")).not.toBeNull();
  });

  it("shows badge when bank transfer confirms during async polling", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_async_confirmed");

    let callCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes(`${SESSION_PATH}?session_id=`)) {
        callCount++;
        // First two calls: asyncPayment pending. Third: confirmed.
        return callCount <= 2 ? json({ pending: true, asyncPayment: true }, 202) : json(CONFIRMED);
      }
      if (url.includes(PROMOTER_PATH)) return json(PROMOTER);
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadModule();

    // The amount itself is what the reader is thanked for, so that is what is
    // asserted — not the class name that happens to carry its type size.
    const container = badgeContainer();
    expect(container.hidden).toBe(false);
    expect(container.textContent).toContain("$50");
    expect(container.textContent).toContain("Alice, thank you for your donation!");

    const promoterCall = fetchMock.mock.calls.find(([input]) => String(input) === PROMOTER_PATH) as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    expect(promoterCall[1].method).toBe("POST");
    // Parsing proves the backend would accept it; a literal comparison would
    // only prove the page sends what the page sends.
    const body = donationPromoterRequestSchema.parse(JSON.parse(String(promoterCall[1].body)));
    expect(body.sessionId).toBe("cs_test_async_confirmed");
  });

  it("does not fetch anything when the session_id is missing or invalid", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=invalid");

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await loadModule();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("announces the wait before the payment has been confirmed", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_wait");

    // Never resolves, so the surface is caught in its loading state.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    await import("../../assets/ts/shared/donation/thank-you");
    await Promise.resolve();

    // The wait carries a name; a bare spinning circle announces nothing.
    const spinner = badgeContainer().querySelector<HTMLElement>("[role='status']");
    expect(spinner?.textContent).toContain("Confirming your donation…");
  });

  it("names the personal share link through a label once the promoter code lands", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_share_named");
    stubConfirmedDonation(() => json(PROMOTER));

    await loadModule();

    const container = badgeContainer();
    const link = controlFor(container, "Your personal share link");
    expect(link.value).toBe(PROMOTER.shareUrl);
    expect(link.readOnly).toBe(true);
    // The guidance is tied to the control rather than floating beside it.
    const helpId = link.getAttribute("aria-describedby");
    expect(container.querySelector(`#${helpId ?? ""}`)?.textContent).toContain("who is driving donations");

    // The social links carry the personal URL too, which is only possible
    // because the badge is re-rendered with it rather than patched in place.
    const share = container.querySelector<HTMLAnchorElement>("[aria-label='Share on LinkedIn']");
    expect(share?.href).toContain(encodeURIComponent(PROMOTER.shareUrl));
  });

  it("reports the copy outcome in a live region instead of renaming the copy control", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_share_copy");
    const restoreClipboard = installClipboard(() => Promise.resolve());
    stubConfirmedDonation(() => json(PROMOTER));

    try {
      await loadModule();

      const container = badgeContainer();
      const copy = container.querySelector<HTMLButtonElement>("[data-share-copy]");
      expect(copy?.textContent).toBe("Copy link");

      copy?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.runAllTimersAsync();

      // The name a reader navigated to is still there; the result arrived
      // beside it instead of replacing it.
      expect(copy?.textContent).toBe("Copy link");
      const outcome = [...container.querySelectorAll<HTMLElement>("[role='status']")].find((el) =>
        el.textContent?.includes("copied"),
      );
      expect(outcome?.textContent).toBe("Link copied to your clipboard.");
    } finally {
      restoreClipboard();
    }
  });

  it("tells the reader what to do when the clipboard refuses", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_share_refused");
    const restoreClipboard = installClipboard(() => Promise.reject(new Error("denied")));
    stubConfirmedDonation(() => json(PROMOTER));

    try {
      await loadModule();

      const container = badgeContainer();
      container
        .querySelector<HTMLButtonElement>("[data-share-copy]")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await vi.runAllTimersAsync();

      expect(container.textContent).toContain("Could not copy automatically");
    } finally {
      restoreClipboard();
    }
  });

  it("keeps the generic share link when the promoter endpoint fails", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_promoter_down");
    stubConfirmedDonation(() => json({ error: { code: "SERVER_ERROR", message: "Promoter codes are down." } }, 500));

    await loadModule();

    const container = badgeContainer();
    // The thank-you still stands; only the personal link is missing, so the
    // copy row is absent rather than offering an empty control.
    expect(container.textContent).toContain("Alice, thank you for your donation!");
    expect(container.querySelector("[data-share-link-row]")).toBeNull();
    const share = container.querySelector<HTMLAnchorElement>("[aria-label='Share on LinkedIn']");
    expect(share?.href).toContain(encodeURIComponent("https://pkic.org/donate/"));
  });

  it("announces a failed payment as an alert that says so in words", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_failed");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ failed: true })),
    );

    await loadModule();

    const alert = badgeContainer().querySelector<HTMLElement>("[role='alert']");
    expect(alert?.textContent).toContain("Payment not completed");
    expect(alert?.textContent).toContain("No funds have been charged.");
  });

  it("announces an expired checkout as an alert, and offers the way back", async () => {
    window.history.replaceState({}, "", "/donate/complete/?session_id=cs_test_expired");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ expired: true })),
    );

    await loadModule();

    const container = badgeContainer();
    const alert = container.querySelector<HTMLElement>("[role='alert']");
    expect(alert?.textContent).toContain("Checkout session expired");
    expect(container.querySelector<HTMLAnchorElement>("a[href='/donate/']")).not.toBeNull();
  });
});
