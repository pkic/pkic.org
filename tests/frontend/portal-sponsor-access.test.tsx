// @vitest-environment jsdom
/**
 * The sponsor workspace's self-service sign-in request.
 *
 * Both controls are design-system Fields now, so what this holds is the part
 * that used to be hand-written and easy to get wrong: the label pointing at
 * the control it names, the required annotation reaching assistive technology,
 * and a confirmation that says it worked rather than opening with a bare "✓".
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sponsorAccessLinkRequestSchema } from "../../assets/shared/schemas/sponsor-access";
import { SponsorAccess } from "../../assets/ts/member-flows/portal/sections/sponsors/Access";

let container: HTMLDivElement | null = null;

function mount(): HTMLDivElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(<SponsorAccess />, container!));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function controlLabelled(root: ParentNode, label: string): HTMLInputElement {
  const match = [...root.querySelectorAll("label")].find((candidate) => candidate.textContent?.startsWith(label));
  const control = match?.htmlFor ? root.querySelector<HTMLInputElement>(`#${match.htmlFor}`) : null;
  if (!control) throw new Error(`No control labelled ${label}`);
  return control;
}

function typeInto(control: HTMLInputElement, value: string): Promise<void> {
  return act(async () => {
    control.value = value;
    control.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  history.replaceState({}, "", "/");
});

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
});

describe("SponsorAccess", () => {
  it("points each label at the control it names and marks both required", () => {
    const root = mount();

    for (const label of ["Email", "Event"]) {
      const control = controlLabelled(root, label);
      expect(control.required).toBe(true);
      // The required marker reaches a screen reader as a word, not a glyph.
      const marker = [...root.querySelectorAll("label")]
        .find((candidate) => candidate.textContent?.startsWith(label))
        ?.querySelector(".pk-field__sr");
      expect(marker?.textContent).toBe("(required)");
    }
    expect(root.querySelector("h2")?.textContent).toBe("Sponsor access");
  });

  it("prefills the event from the hash query, so a sponsor never types their slug", () => {
    history.replaceState({}, "", "/portal/#/sponsors/access?event=pqc-conference-amsterdam-nl");
    const root = mount();

    expect(controlLabelled(root, "Event").value).toBe("pqc-conference-amsterdam-nl");
  });

  it("sends a body the shared access-link contract accepts, and confirms in words", async () => {
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (typeof init?.body === "string") bodies.push(JSON.parse(init.body));
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );

    const root = mount();
    await typeInto(controlLabelled(root, "Email"), " sponsor@example.test ");
    await typeInto(controlLabelled(root, "Event"), " pqc-2026 ");
    await act(async () => {
      root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await Promise.resolve();
    });
    await settle();

    expect(bodies).toHaveLength(1);
    // Parsed through the shared request schema rather than compared to a
    // literal, so the assertion follows the contract as it changes.
    const parsed = sponsorAccessLinkRequestSchema.parse(bodies[0]);
    expect(parsed.email).toBe("sponsor@example.test");
    expect(parsed.eventSlug).toBe("pqc-2026");

    const confirmation = root.querySelector('[role="status"]');
    expect(confirmation?.textContent).toContain("you'll receive a sign-in link shortly");
    expect(confirmation?.classList.contains("pk-alert--ok")).toBe(true);
  });

  it("makes no request at all until both halves are filled in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const root = mount();
    await typeInto(controlLabelled(root, "Email"), "sponsor@example.test");
    await act(async () => {
      root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await Promise.resolve();
    });
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("announces a rejected request as an alert rather than a red box", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "rate_limited", message: "Too many attempts." } }), {
            status: 429,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    const root = mount();
    await typeInto(controlLabelled(root, "Email"), "sponsor@example.test");
    await typeInto(controlLabelled(root, "Event"), "pqc-2026");
    await act(async () => {
      root.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      await Promise.resolve();
    });
    await settle();

    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Too many attempts.");
    expect(alert?.classList.contains("pk-alert--danger")).toBe(true);
    // The form is still there to correct and retry from.
    expect(root.querySelector("form")).not.toBeNull();
  });
});
