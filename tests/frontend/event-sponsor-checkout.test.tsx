// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToString } from "preact-render-to-string";
import { EventSponsorCheckoutForm } from "../../assets/ts/site/EventSponsorCheckoutForm";
import { initializeEventSponsorCheckout } from "../../assets/ts/member-flows/event-sponsor-page";
import { publicSponsorTiersResponseSchema } from "../../assets/shared/schemas/sponsors";
import { sponsorshipCheckoutSchema } from "../../assets/shared/schemas/sponsorship";

const catalogKey = "/api/v1/sponsors/tiers?sponsorType=event";

function mount(tiers: string[] = ["Synthetic Standard", "Synthetic Plus"]) {
  document.body.innerHTML = renderToString(<EventSponsorCheckoutForm slug="synthetic-conference" />);
  const publication = document.createElement("template");
  publication.id = "pkic-public-form-resources";
  publication.content.textContent = JSON.stringify({
    [catalogKey]: publicSponsorTiersResponseSchema.parse({
      visibility: "public",
      sponsorType: "event",
      tiers: tiers.map((tier) => ({ tier })),
    }),
  });
  document.body.append(publication);
  const root = document.querySelector<HTMLElement>("[data-event-sponsor-checkout]")!;
  const form = root.querySelector<HTMLFormElement>("form")!;
  const tier = form.querySelector<HTMLSelectElement>("[name=tier]")!;
  const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
  return { root, form, tier, submit };
}

function fill(form: HTMLFormElement, name: string, value: string) {
  const control = form.querySelector<HTMLInputElement>(`[name=${name}]`)!;
  control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
  window.history.replaceState(null, "", "/events/2026/synthetic-conference/sponsors/");
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("renders labeled shared checkout controls and enables only the published configured tiers without a visitor fetch", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { root, form, tier, submit } = mount();
  expect(root.dataset.module).toBe("member-flows/event-sponsor-page");
  expect(root.dataset.eventSlug).toBe("synthetic-conference");
  expect(form.noValidate).toBe(true);
  expect(tier.disabled).toBe(true);
  expect(submit.disabled).toBe(true);
  for (const name of ["firstName", "lastName", "email", "organizationName", "tier"]) {
    const control = form.querySelector<HTMLInputElement>(`[name=${name}]`)!;
    expect(form.querySelector(`label[for=${control.id}]`)).not.toBeNull();
  }
  await initializeEventSponsorCheckout(root);
  expect(Array.from(tier.options).map((option) => option.value)).toEqual(["", "Synthetic Standard", "Synthetic Plus"]);
  expect(tier.disabled).toBe(false);
  expect(submit.disabled).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it("validates the actual checkout request and retains editable controls after a provider refusal", async () => {
  const requests: unknown[] = [];
  const fetch = vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push(sponsorshipCheckoutSchema.parse(JSON.parse(String(init.body))));
    return new Response(JSON.stringify({ message: "Synthetic checkout unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
  const { root, form, tier, submit } = mount();
  await initializeEventSponsorCheckout(root);
  fill(form, "firstName", "Casey");
  fill(form, "lastName", "Sponsor");
  fill(form, "email", "casey@example.test");
  fill(form, "organizationName", "Synthetic sponsor");
  tier.value = "Synthetic Plus";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => {
    expect(requests).toHaveLength(1);
    expect(submit.disabled).toBe(false);
  });
  expect(requests[0]).toMatchObject({
    contactName: "Casey Sponsor",
    contactEmail: "casey@example.test",
    organizationName: "Synthetic sponsor",
    tier: "Synthetic Plus",
    eventId: "synthetic-conference",
    successPath: "/events/2026/synthetic-conference/sponsors/complete/",
    cancelPath: "/events/2026/synthetic-conference/sponsors/",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(root.querySelector("[data-flow-status]")?.getAttribute("data-state")).toBe("error");
});

it("refuses incomplete contact details before checkout submission", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const { root, form, tier } = mount();
  await initializeEventSponsorCheckout(root);
  tier.value = "Synthetic Standard";
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expect(fetch).not.toHaveBeenCalled();
  expect(form.classList.contains("was-validated")).toBe(true);
  expect(form.querySelector("[name=email]")?.closest(".pk-field")?.classList.contains("pk-field--invalid")).toBe(true);
});

it.each(["empty", "missing", "malformed"])(
  "keeps checkout unavailable for a %s published catalog without a database fallback",
  async (kind) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { root, tier, submit } = mount([]);
    const publication = document.querySelector<HTMLTemplateElement>("#pkic-public-form-resources")!;
    if (kind === "missing") publication.content.textContent = "{}";
    if (kind === "malformed")
      publication.content.textContent = JSON.stringify({ [catalogKey]: { tiers: ["unvalidated"] } });
    await initializeEventSponsorCheckout(root);
    expect(tier.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(root.querySelector("[data-flow-status]")?.textContent).toContain("temporarily unavailable");
    expect(fetch).not.toHaveBeenCalled();
  },
);
