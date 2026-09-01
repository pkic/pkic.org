// @vitest-environment jsdom
/**
 * The speaker self-service page, driven the way a browser drives it.
 *
 * The module runs `main()` at import, so each case builds the shortcode's
 * markup, stubs the network, then imports it. Two things moved with the
 * design-system migration and are asserted here because nothing else can see
 * them: visibility is now the platform's `hidden` attribute rather than
 * Bootstrap's `d-none` — a `display: none !important` class the attribute
 * cannot out-rank, so the two sides had to move together — and the status
 * pills are the system's `pk-badge` tones rather than `bg-success` and
 * friends. The failure path is the terms request: when it fails the reader
 * gets an announced alert rather than a red sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";

const READ = "/api/v1/proposals/speakers/access/speaker-token-1234567890";
const TERMS = "/api/v1/events/pqc-2026/terms";

interface Captured {
  path: string;
  method: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function speakerPage(overrides: { status?: string; proposalStatus?: string } = {}): Record<string, unknown> {
  return {
    speaker: {
      role: "speaker",
      status: overrides.status ?? "invited",
      confirmedAt: null,
      declinedAt: null,
      termsAcceptedAt: null,
    },
    proposal: {
      id: "30000000-0000-4000-8000-000000000001",
      title: "Post-quantum migration in practice",
      proposalType: "talk",
      status: overrides.proposalStatus ?? "submitted",
      presentationDeadline: null,
      presentationUploaded: false,
      presentationUploadedAt: null,
      presentationUploader: null,
      coSpeakers: [],
      presentationUrl: null,
    },
    presentationTerms: [],
    profile: {
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      organizationName: null,
      jobTitle: null,
      biography: null,
      links: [],
      headshotUploaded: false,
      headshotUpdatedAt: null,
      headshotUrl: null,
    },
  };
}

/** The shape `eventTermsResponseSchema` demands, with no terms configured. */
function speakerTerms(): Record<string, unknown> {
  return {
    event: { id: "20000000-0000-4000-8000-000000000001", slug: "pqc-2026", name: "PQC Conference 2026" },
    audience: "speaker",
    terms: [],
  };
}

function installApi(routes: Record<string, () => Response>): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input), location.origin);
      requests.push({ path: url.pathname, method: (init.method ?? "GET").toUpperCase() });
      const route = routes[url.pathname];
      return Promise.resolve(route ? route() : json({}));
    }),
  );
  return requests;
}

/** The shortcode's markup, reduced to the parts this module reaches for. */
function mountShell(): HTMLElement {
  document.body.innerHTML = `
    <div class="event-flow pk"
      data-event-speaker-manage
      data-event-slug="pqc-2026"
      data-api-base="/api/v1">
      <div data-resend-speaker-manage-section hidden>
        <input data-resend-speaker-manage-email>
        <button type="button" data-resend-speaker-manage-btn>Send my speaker link</button>
        <p data-resend-speaker-manage-status></p>
      </div>
      <p data-speaker-loading>Loading your speaker details…</p>
      <div data-speaker-content hidden>
        <div data-proposal-summary>
          <h3 data-proposal-title></h3>
          <p><span data-proposal-type></span><span class="pk-badge" data-proposal-status-badge></span></p>
          <p data-presentation-deadline-row></p>
        </div>
        <p><span class="pk-badge" data-speaker-status-badge></span></p>
        <div data-confirm-panel hidden>
          <form data-confirm-form novalidate>
            <div data-speaker-consents></div>
            <button type="submit">Confirm participation</button>
            <button type="button" data-decline-open>Decline</button>
          </form>
        </div>
        <div data-decline-panel hidden>
          <textarea id="decline-reason"></textarea>
          <button type="button" data-decline-confirm>Confirm — I cannot participate</button>
          <button type="button" data-decline-cancel>Go back</button>
        </div>
        <p data-confirmed-msg hidden>You have confirmed your participation. Thank you!</p>
        <p data-declined-msg hidden>You have declined participation in this session.</p>
        <div data-headshot-section hidden>
          <div data-headshot-preview></div>
          <p data-headshot-status></p>
          <input type="file" id="speaker-headshot-file" data-headshot-file>
          <button type="button" data-headshot-delete hidden>Remove photo</button>
        </div>
        <div data-profile-section hidden>
          <div data-profile-saved-state hidden>
            <button type="button" data-profile-edit>Edit profile</button>
          </div>
          <div data-profile-form-wrap>
            <form data-profile-form novalidate>
              <input id="speaker-first-name" name="firstName">
              <input id="speaker-last-name" name="lastName">
              <input id="speaker-organization" name="organizationName">
              <input id="speaker-job-title" name="jobTitle">
              <textarea id="speaker-bio" name="biography"></textarea>
              <div data-profile-links-container></div>
              <button type="submit">Save profile</button>
            </form>
          </div>
        </div>
        <div data-presentation-link hidden><a href="presentation/">Go to presentation upload</a></div>
        <p data-flow-status class="pk-alert pk-sr-only" role="status" aria-live="polite" hidden></p>
      </div>
    </div>
  `;
  const root = document.querySelector<HTMLElement>("[data-event-speaker-manage]");
  if (!root) throw new Error("shell did not mount");
  return root;
}

async function boot(): Promise<void> {
  await act(async () => {
    await import("../../assets/ts/event-flows/speaker-manage-page");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function panel(root: ParentNode, name: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(`[${name}]`);
  if (!element) throw new Error(`no element carries [${name}]`);
  return element;
}

beforeEach(() => {
  vi.resetModules();
  window.history.replaceState({}, "", "/events/2026/pqc-2026/speaker/?token=speaker-token-1234567890");
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  window.history.replaceState({}, "", "/");
});

describe("speaker self-service page", () => {
  it("reveals the content through the hidden attribute the template carries, not a class", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage()), [TERMS]: () => json(speakerTerms()) });

    await boot();

    // `d-none` is `display: none !important`, which `hidden` cannot out-rank —
    // so a page that swapped one side without the other could never be shown.
    expect(panel(root, "data-speaker-loading").hidden).toBe(true);
    expect(panel(root, "data-speaker-content").hidden).toBe(false);
    // None of the panels this module switches carries a visibility class any
    // more; the attribute is the only switch.
    for (const name of [
      "data-speaker-content",
      "data-confirm-panel",
      "data-decline-panel",
      "data-confirmed-msg",
      "data-declined-msg",
      "data-headshot-section",
      "data-profile-section",
      "data-presentation-link",
    ]) {
      expect(panel(root, name).className).not.toContain("d-none");
    }
  });

  it("paints both status pills with the design system's tone, not a Bootstrap background", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage()), [TERMS]: () => json(speakerTerms()) });

    await boot();

    const speakerBadge = panel(root, "data-speaker-status-badge");
    expect(speakerBadge.textContent).toBe("Invited");
    expect(speakerBadge.className).toBe("pk-badge pk-badge--warn");

    const proposalBadge = panel(root, "data-proposal-status-badge");
    expect(proposalBadge.textContent).toBe("Submitted");
    expect(proposalBadge.className).toBe("pk-badge pk-badge--info");
  });

  it("opens the confirm panel for an invited speaker", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage()), [TERMS]: () => json(speakerTerms()) });

    await boot();

    expect(panel(root, "data-confirm-panel").hidden).toBe(false);
    expect(panel(root, "data-confirmed-msg").hidden).toBe(true);
    expect(panel(root, "data-declined-msg").hidden).toBe(true);
    // The editors are open for anyone who has not declined: the status branch
    // near the top of the module hides them for an invited speaker, and the
    // one at the bottom — which runs unconditionally — opens them again. That
    // ordering predates this migration and is preserved by it; the assertion
    // records what the page actually does rather than what the first branch
    // reads as.
    expect(panel(root, "data-headshot-section").hidden).toBe(false);
    expect(panel(root, "data-profile-section").hidden).toBe(false);
  });

  it("opens the editors for a confirmed speaker and the presentation link once accepted", async () => {
    const root = mountShell();
    installApi({
      [READ]: () => json(speakerPage({ status: "confirmed", proposalStatus: "accepted" })),
      [TERMS]: () => json(speakerTerms()),
    });

    await boot();

    expect(panel(root, "data-confirmed-msg").hidden).toBe(false);
    expect(panel(root, "data-headshot-section").hidden).toBe(false);
    expect(panel(root, "data-profile-section").hidden).toBe(false);
    expect(panel(root, "data-presentation-link").hidden).toBe(false);
  });

  it("keeps the editors closed for a speaker who declined", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage({ status: "declined" })), [TERMS]: () => json(speakerTerms()) });

    await boot();

    expect(panel(root, "data-declined-msg").hidden).toBe(false);
    expect(panel(root, "data-headshot-section").hidden).toBe(true);
    expect(panel(root, "data-profile-section").hidden).toBe(true);
  });

  it("announces a failed terms request as an alert rather than a red sentence", async () => {
    const root = mountShell();
    installApi({
      [READ]: () => json(speakerPage()),
      [TERMS]: () => json({ error: "unavailable" }, 503),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await boot();

    const consents = panel(root, "data-speaker-consents");
    const alert = consents.querySelector(".pk-alert");
    // `role="alert"` is what interrupts; a `text-danger` paragraph said the
    // same thing only to whoever could see the colour.
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(alert?.className).toContain("pk-alert--danger");
    expect(alert?.textContent).toContain("Could not load required terms right now.");
  });

  it("shows the recovery form and reaches no speaker resource when the token is absent", async () => {
    window.history.replaceState({}, "", "/events/2026/pqc-2026/speaker/");
    const root = mountShell();
    const requests = installApi({});

    await boot();

    expect(requests.some(({ path }) => path.startsWith("/api/v1/proposals/speakers/access/"))).toBe(false);
    expect(panel(root, "data-resend-speaker-manage-section").hidden).toBe(false);
    expect(panel(root, "data-speaker-content").hidden).toBe(true);
  });

  it("toggles the decline panel through the attribute, both ways", async () => {
    const root = mountShell();
    installApi({ [READ]: () => json(speakerPage()), [TERMS]: () => json(speakerTerms()) });

    await boot();

    const decline = panel(root, "data-decline-panel");
    expect(decline.hidden).toBe(true);

    await act(async () => {
      panel(root, "data-decline-open").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(decline.hidden).toBe(false);

    await act(async () => {
      panel(root, "data-decline-cancel").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(decline.hidden).toBe(true);
  });
});
