// @vitest-environment jsdom
/**
 * The invite-decline page's script against the shortcode's markup.
 *
 * The shortcode has already moved to the design system, so what this guards
 * is the half that is easy to get wrong and that no gate can see: the script
 * repainting those elements. Assigning `alert alert-warning` to a banner the
 * template renders as `pk-alert` removes the styling entirely, and the score
 * buttons signalled the chosen value with a fill and nothing else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inviteDeclineSchema } from "../../assets/shared/schemas/registration";
// @ts-expect-error Vite's raw-loader suffix is available to frontend tests.
import inviteDeclineTemplate from "../../layouts/shortcodes/invite-decline.html?raw";
import { mountTemplate } from "./helpers/hugo-template";

/**
 * Hugo's `range seq 1 10` writes the ten score buttons; the raw template holds
 * the one that is repeated. Cloning it keeps the shipped classes and
 * attributes — which is what these tests assert on — instead of restating them.
 */
function expandScoreButtons(): void {
  const group = document.querySelector<HTMLElement>("[data-nps-buttons]");
  const button = group?.querySelector("button");
  if (!group || !button) return;
  const scores = Array.from({ length: 10 }, (_, index) => {
    const clone = button.cloneNode(true) as HTMLButtonElement;
    clone.dataset.nps = String(index + 1);
    clone.textContent = String(index + 1);
    return clone;
  });
  button.replaceWith(...scores);
}

const VALID_INVITE = {
  status: "valid",
  eventName: "Spring Summit",
  inviteeFirstName: "Ada",
  inviteType: "attendee",
  registrationUrl: "https://example.test/register",
  proposalUrl: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function el<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function boot(): Promise<void> {
  vi.resetModules();
  await import("../../assets/ts/invite-decline");
  await settle();
}

beforeEach(() => {
  // The shipped markup, not a copy of it. The copy this replaced had drifted
  // to loose labels, missing `pk-check` wrappers and a `data-forward-max` the
  // template does not set — every assertion still passing against markup the
  // site no longer serves.
  mountTemplate(inviteDeclineTemplate);
  document.querySelector<HTMLElement>("[data-invite-decline]")!.dataset.forwardMax = "3";
  expandScoreButtons();
  history.replaceState({}, "", "/?token=tok-abc");
});

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("invite-decline status banner", () => {
  it("repaints the banner in the design system's vocabulary, not Bootstrap's", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ status: "already_processed" }))),
    );
    await boot();

    const alert = el("[data-status-alert]");
    expect(alert.className).toBe("pk-alert pk-alert--info");
    for (const name of alert.classList) expect(name.startsWith("pk-")).toBe(true);
    // The banner stays a live region and the words say what happened.
    expect(alert.getAttribute("role")).toBe("alert");
    expect(el("[data-status-title]").textContent).toBe("Invitation already processed");
    expect(el("[data-decline-status]").hidden).toBe(false);
  });

  it("uses the danger tone when the invitation cannot be loaded at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(json({ error: { code: "boom", message: "no" } }, 500))),
    );
    await boot();

    expect(el("[data-status-alert]").className).toBe("pk-alert pk-alert--danger");
    expect(el("[data-status-body]").textContent).toContain("could not load your invitation");
  });

  it("uses the warning tone and offers recovery when the link has no token", async () => {
    history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn());
    await boot();

    expect(el("[data-status-alert]").className).toBe("pk-alert pk-alert--warn");
    expect(el("[data-resend-invite-section]").hidden).toBe(false);
  });
});

describe("invite-decline form", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(init?.method === "POST" ? json({ success: true, forwarded: [] }) : json(VALID_INVITE)),
      ),
    );
  });

  it("states the chosen score rather than leaving it to the fill", async () => {
    await boot();

    const [one, two] = document.querySelectorAll<HTMLButtonElement>("[data-nps]");
    expect(one.getAttribute("aria-pressed")).toBe("false");

    one.click();
    expect(one.getAttribute("aria-pressed")).toBe("true");
    expect(one.className).toContain("pk-btn--primary");
    expect(one.className).not.toContain("pk-btn--secondary");
    expect(two.getAttribute("aria-pressed")).toBe("false");

    two.click();
    expect(one.getAttribute("aria-pressed")).toBe("false");
    expect(one.className).toContain("pk-btn--secondary");
    expect(two.getAttribute("aria-pressed")).toBe("true");
    expect(el<HTMLInputElement>("[data-nps-value]").value).toBe("2");
  });

  it("says the comment is required in words, in colour, and to the control", async () => {
    await boot();

    const other = el<HTMLInputElement>('input[value="other"]');
    other.checked = true;
    other.dispatchEvent(new Event("change", { bubbles: true }));

    const marker = el("[data-note-optional]");
    expect(marker.textContent?.trim()).toBe("(required)");
    expect(marker.className).toBe("pk-required");
    expect(el("[data-reason-note]").getAttribute("aria-required")).toBe("true");

    const conflict = el<HTMLInputElement>('input[value="schedule_conflict"]');
    conflict.checked = true;
    conflict.dispatchEvent(new Event("change", { bubbles: true }));
    expect(marker.textContent?.trim()).toBe("(optional)");
    expect(marker.className).toBe("pk-muted");
    expect(el("[data-reason-note]").getAttribute("aria-required")).toBe("false");
  });

  it("names every control in a forwarded-contact row, and renumbers after a removal", async () => {
    await boot();

    el("[data-add-forward]").click();
    el("[data-add-forward]").click();

    const rows = document.querySelectorAll("[data-forward-row]");
    expect(rows).toHaveLength(2);
    const names = [...rows[0].querySelectorAll("input, button")].map((control) => control.getAttribute("aria-label"));
    expect(names).toEqual([
      "Contact 1: first name",
      "Contact 1: last name",
      "Contact 1: email address (required)",
      "Remove contact 1",
    ]);
    expect(rows[0].querySelector("input")?.className).toBe("pk-input");

    // Removing the first row must not leave the second one called "Contact 2".
    rows[0].querySelector<HTMLButtonElement>("[data-remove-row]")?.click();
    const remaining = document.querySelectorAll("[data-forward-row]");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].querySelector("input")?.getAttribute("aria-label")).toBe("Contact 1: first name");
  });

  it("refuses to submit without a reason, and announces why", async () => {
    await boot();
    const posts: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") posts.push(init);
        return Promise.resolve(json({ success: true, forwarded: [] }));
      }),
    );

    el<HTMLFormElement>("[data-decline-form-el]").dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();

    expect(posts).toHaveLength(0);
    expect(el("[data-reason-error]").hidden).toBe(false);
  });

  it("sends a body the shared decline contract accepts", async () => {
    await boot();
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST" && typeof init.body === "string") bodies.push(JSON.parse(init.body));
        return Promise.resolve(json({ success: true, forwarded: [] }));
      }),
    );

    const conflict = el<HTMLInputElement>('input[value="schedule_conflict"]');
    conflict.checked = true;
    conflict.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-nps="2"]')?.click();

    el<HTMLFormElement>("[data-decline-form-el]").dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();

    expect(bodies).toHaveLength(1);
    // Parsed through the shared request schema rather than compared to a
    // literal, so the assertion tracks the contract as it changes.
    const parsed = inviteDeclineSchema.parse(bodies[0]);
    expect(parsed.reasonCode).toBe("schedule_conflict");
    expect(parsed.npsScore).toBe(2);
  });
});
