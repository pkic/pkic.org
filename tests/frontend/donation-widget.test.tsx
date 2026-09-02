// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { donationCheckoutSchema } from "../../assets/shared/schemas/donation";
import { buildDonationWidget } from "../../assets/ts/shared/donation/widget";
import { initDonationForm } from "../../assets/ts/shared/donation/form";
import { controlFor, labelNames } from "./helpers/labelled-control";

const GEO_PATH = "/api/v1/geolocation/country";
const CHECKOUT_PATH = "/api/v1/donations/checkout";

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

interface Captured {
  path: string;
  body: unknown;
}

/**
 * The checkout endpoint answers with the API's error envelope. That is both
 * the widget's failure path and the only way to inspect a real request body
 * without Stripe.js: a successful reply would send the form on to
 * `initEmbeddedCheckout`, which cannot load in jsdom.
 */
function installApi(): Captured[] {
  const requests: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      requests.push({ path: url.pathname, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
      if (url.pathname === GEO_PATH) return Promise.resolve(json({ country: "US" }));
      if (url.pathname === CHECKOUT_PATH) {
        return Promise.resolve(json({ error: { code: "CARD_DECLINED", message: "Payments are paused." } }, 502));
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    }),
  );
  return requests;
}

function place(widget: HTMLElement): HTMLElement {
  document.body.append(widget);
  mounted.push(widget);
  return widget;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function click(target: HTMLElement): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

function submitButton(widget: HTMLElement): HTMLButtonElement {
  const button = widget.querySelector<HTMLButtonElement>("[data-donation-submit]");
  if (!button) throw new Error("no donate button");
  return button;
}

async function start(widget: HTMLElement): Promise<void> {
  const form = widget.querySelector<HTMLElement>("[data-donation-form]");
  if (!form) throw new Error("no donation form root");
  initDonationForm(form);
  await settle();
  await settle();
}

afterEach(() => {
  for (const widget of mounted.splice(0)) widget.remove();
  vi.unstubAllGlobals();
});

describe("donation widget markup", () => {
  it("names every donor control through a label, not a placeholder", () => {
    const widget = place(buildDonationWidget());

    expect(labelNames(widget)).toEqual([
      "Full name",
      "Email",
      "Organization (optional)",
      "Currency",
      "Or enter a custom amount",
    ]);

    // Resolved through the `for`/`id` pair itself, so the lookup fails exactly
    // when the labelling contract is broken.
    expect(controlFor(widget, "Full name").required).toBe(true);
    expect(controlFor(widget, "Full name").hasAttribute("data-donation-name-input")).toBe(true);
    expect(controlFor<HTMLSelectElement>(widget, "Currency").tagName).toBe("SELECT");
    const custom = controlFor(widget, "Or enter a custom amount");
    expect(custom.type).toBe("number");
    // The currency symbol is live and the label is a string, so the symbol sits
    // with the control and the control describes itself by it.
    const prefix = widget.querySelector("[data-donation-currency-prefix]");
    expect(prefix?.textContent).toBe("$");
    const description = widget.querySelector(`[id="${custom.getAttribute("aria-describedby")!}"]`);
    expect(description?.contains(prefix!)).toBe(true);
  });

  it("exposes the outcome line as a live region that exists before there is a message", () => {
    const widget = place(buildDonationWidget());
    const status = widget.querySelector<HTMLElement>("[data-donation-status]");

    expect(status?.getAttribute("role")).toBe("status");
    expect(status?.hidden).toBe(true);
  });

  it("keeps the currency select named when the identity fields are hidden", () => {
    const widget = place(buildDonationWidget({ hideIdentityFields: true }));

    expect(labelNames(widget)).toEqual(["Or enter a custom amount"]);
    const currency = widget.querySelector<HTMLSelectElement>("[data-donation-currency]");
    expect(currency?.getAttribute("aria-label")).toBe("Currency");
    // The identity values still travel, they are just not asked for again.
    expect(widget.querySelector<HTMLInputElement>("[data-donation-name-input]")?.type).toBe("hidden");
  });

  it("leaves the preset amounts to the behaviour that knows the currency", () => {
    const widget = place(buildDonationWidget());

    expect(widget.querySelector("[data-donation-presets]")?.children).toHaveLength(0);
  });
});

describe("donation widget wiring", () => {
  it("hands initDonationForm every hook it looks for", async () => {
    installApi();
    const widget = place(buildDonationWidget());
    await start(widget);

    const presets = widget.querySelectorAll("[data-preset-amount]");
    expect(presets.length).toBeGreaterThan(0);
    // The default amount is pre-selected, which is only possible if the
    // container the behaviour renders into is the one this markup built.
    expect(widget.querySelector('[data-preset-amount="500"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(submitButton(widget).textContent).toContain("Donate");
  });

  it("sends a checkout request the shared contract accepts, and reports the refusal", async () => {
    const requests = installApi();
    const widget = place(buildDonationWidget());
    await start(widget);

    controlFor(widget, "Full name").value = "Ada Lovelace";
    await click(submitButton(widget));

    const checkout = requests.find((request) => request.path === CHECKOUT_PATH);
    // Parsing proves the backend would accept it; a literal comparison would
    // only prove the widget sends what the widget sends.
    const body = donationCheckoutSchema.parse(checkout?.body);
    expect(body.name).toBe("Ada Lovelace");
    expect(body.currency).toBe("usd");
    expect(body.amount).toBeGreaterThan(0);

    const status = widget.querySelector<HTMLElement>("[data-donation-status]");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toBe("Payments are paused.");
    // A refused checkout must hand the button back rather than stay busy.
    expect(submitButton(widget).disabled).toBe(false);
  });

  it("refuses to check out without a name, and never reaches the network", async () => {
    const requests = installApi();
    const widget = place(buildDonationWidget());
    await start(widget);

    await click(submitButton(widget));

    const status = widget.querySelector<HTMLElement>("[data-donation-status]");
    expect(status?.textContent).toBe("Please enter your full name.");
    expect(status?.hidden).toBe(false);
    expect(requests.some((request) => request.path === CHECKOUT_PATH)).toBe(false);
  });
});
