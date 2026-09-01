// @vitest-environment jsdom
/**
 * The System Operations tab strip.
 *
 * The version this covers announced `role="tab"` on loose buttons with no
 * tablist around them and nothing tying a tab to the panel it revealed, so
 * the promise `role="tab"` makes — one tab in the tab order, arrows between
 * them, a named panel on the other end — was not kept by anything.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "preact";
import { Operations } from "../../assets/ts/member-flows/portal/sections/system-operations/Operations";

let container: HTMLDivElement | null = null;
let toastArea: HTMLDivElement | null = null;

type OperationsGrants = ComponentProps<typeof Operations>;

const ALL_GRANTED: OperationsGrants = {
  canReadEmail: true,
  canManageEmail: true,
  canReadRetention: true,
  canReadScheduler: true,
  canRunRetention: true,
  canAnonymizeUsers: true,
  canWriteMembership: true,
  canApproveMembership: true,
};

const NONE_GRANTED: OperationsGrants = {
  canReadEmail: false,
  canManageEmail: false,
  canReadRetention: false,
  canReadScheduler: false,
  canRunRetention: false,
  canAnonymizeUsers: false,
  canWriteMembership: false,
  canApproveMembership: false,
};

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(props: OperationsGrants): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(<Operations {...props} />, container!);
    await Promise.resolve();
  });
  await settle();
  return container;
}

beforeEach(() => {
  toastArea = document.createElement("div");
  toastArea.id = "portal-toast-area";
  document.body.append(toastArea);
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ items: [], page: { total: 0, limit: 25, offset: 0 } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
});

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  toastArea?.remove();
  toastArea = null;
  vi.unstubAllGlobals();
});

describe("portal Operations tabs", () => {
  it("wraps the tabs in a named tablist rather than loose buttons in a nav", async () => {
    const root = await mount(ALL_GRANTED);

    const tablist = root.querySelector('[role="tablist"]');
    expect(tablist?.getAttribute("aria-label")).toBe("System operations");
    expect([...root.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
      "Email Outbox",
      "Scheduled Work",
      "Scheduled Jobs",
    ]);
  });

  it("points the selected tab at the panel it reveals, and the panel back at the tab", async () => {
    const root = await mount(ALL_GRANTED);

    const selected = root.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    expect(selected?.textContent).toBe("Email Outbox");

    const panelId = selected?.getAttribute("aria-controls");
    expect(panelId).toBe("system-operations-outbox-panel");
    const panel = root.querySelector(`#${panelId ?? ""}`);
    expect(panel?.getAttribute("role")).toBe("tabpanel");
    expect(panel?.getAttribute("aria-labelledby")).toBe(selected?.id);
  });

  it("keeps exactly one tab in the tab order, as the pattern requires", async () => {
    const root = await mount(ALL_GRANTED);

    const order = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].map((tab) => tab.tabIndex);
    expect(order.filter((index) => index === 0)).toHaveLength(1);
  });

  it("moves selection with the arrow keys", async () => {
    const root = await mount(ALL_GRANTED);

    const first = root.querySelector<HTMLButtonElement>('[role="tab"]');
    await act(async () => {
      first?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
    });
    await settle();

    const tabs = root.querySelectorAll('[role="tab"]');
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector('[role="tabpanel"]')?.id).toBe("system-operations-scheduled-work-panel");
  });

  it("offers only the tabs the account may read", async () => {
    const root = await mount({ ...NONE_GRANTED, canReadRetention: true, canRunRetention: true });

    expect([...root.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual(["Scheduled Work"]);
  });

  it("says so, as an announced message, when no operations access is granted", async () => {
    const root = await mount(NONE_GRANTED);

    const alert = root.querySelector('[role="alert"]');
    // A warning is announced by its role, and the sentence carries the
    // meaning on its own rather than leaning on the tone behind it.
    expect(alert?.textContent).toContain("Operations access is not assigned to this account.");
    expect(alert?.classList.contains("pk-alert--warn")).toBe(true);
    expect(root.querySelector('[role="tablist"]')).toBeNull();
  });
});
