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

const SHORTCODE = `
  <div data-invite-decline data-api-base="/api/v1" data-forward-max="3">
    <div data-decline-loading></div>
    <div data-decline-status hidden>
      <div class="pk-alert pk-alert--info" data-status-alert role="alert">
        <h2 class="pk-alert__title" data-status-title></h2>
        <p data-status-body></p>
      </div>
      <div data-resend-invite-section hidden>
        <label class="pk-field__label" for="resend-invite-email">Email address from the invitation</label>
        <input id="resend-invite-email" type="email" class="pk-input" data-resend-invite-email>
        <button type="button" class="pk-btn pk-btn--primary" data-resend-invite-btn>Send fresh invitation</button>
        <p data-resend-invite-status></p>
      </div>
    </div>
    <div data-decline-form hidden>
      <strong data-placeholder="firstName">there</strong>
      <div data-error-banner class="pk-alert pk-alert--danger" hidden role="alert"></div>
      <div data-virtual-pivot data-attendee-only class="pk-alert pk-alert--info" hidden></div>
      <div data-on-demand-pivot data-attendee-only class="pk-alert pk-alert--info" hidden></div>
      <div data-convince-boss data-attendee-only class="pk-alert pk-alert--info" hidden></div>
      <form data-decline-form-el novalidate>
        <div data-reason-options>
          <label><input class="pk-check__input" type="radio" name="reasonCode" value="schedule_conflict"></label>
          <label><input class="pk-check__input" type="radio" name="reasonCode" value="content_not_relevant"></label>
          <label><input class="pk-check__input" type="radio" name="reasonCode" value="other"></label>
        </div>
        <div data-reason-error class="pk-field__message" hidden></div>
        <div data-topic-suggestion hidden><input id="topicSuggestion" data-topic-input class="pk-input"></div>
        <label class="pk-field__label" for="reasonNote">
          Additional comments <span data-note-optional class="pk-muted">(optional)</span>
        </label>
        <textarea id="reasonNote" data-reason-note class="pk-input pk-input--textarea"></textarea>
        <div data-note-error class="pk-field__message" hidden></div>
        <div class="pk-cluster" data-nps-buttons role="group" aria-label="Likelihood score 1 to 10">
          <button type="button" class="pk-btn pk-btn--secondary pk-btn--sm nps-btn" data-nps="1">1</button>
          <button type="button" class="pk-btn pk-btn--secondary pk-btn--sm nps-btn" data-nps="2">2</button>
        </div>
        <input type="hidden" data-nps-value>
        <input type="checkbox" id="unsubscribeFuture" data-unsubscribe-future>
        <button type="button" class="pk-btn pk-btn--link" data-forward-toggle aria-expanded="false"
          aria-controls="forwardEntries"><span data-forward-arrow aria-hidden="true">▶</span></button>
        <div id="forwardEntries" data-forward-entries hidden>
          <textarea data-decline-forward-paste class="pk-input pk-input--textarea"></textarea>
          <div class="event-flow-invite-list" data-forward-list></div>
          <button type="button" class="pk-btn pk-btn--secondary pk-btn--sm" data-add-forward>+ Add a contact</button>
        </div>
        <button type="submit" class="pk-btn pk-btn--danger" data-submit-btn>
          <span data-copy-target="submit">Decline this invitation</span>
        </button>
      </form>
    </div>
    <div data-decline-success hidden><p data-success-forwarded></p></div>
  </div>`;

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
  document.body.innerHTML = SHORTCODE;
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
