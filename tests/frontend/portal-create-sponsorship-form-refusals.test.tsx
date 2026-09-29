// @vitest-environment jsdom
/**
 * How the create-sponsorship form refuses, and who gets the fallback.
 *
 * The happy paths — what the form offers per sponsor type and what it sends —
 * live in portal-create-sponsorship-form.test.tsx. Asserted here instead:
 * a contract refusal is named on its own field before anything is sent, the
 * server's validation details land on the fields they name, a transport
 * refusal is announced as an alert in English, the draft survives every one
 * of those, and an account that cannot read the organization directory keeps
 * a raw id input instead of a picker that could only fail.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { sponsorshipCreateSchema } from "../../assets/shared/schemas/sponsorship-management";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";
import {
  ORGANIZATION_ID,
  cleanupForm,
  installToastArea,
  mountForm,
  organizationsPage,
  settle,
  signInAsDirectoryReader,
  stubFetch,
} from "./helpers/create-sponsorship-form";
import { buttonNamed, chooseComboboxOption, controlFor, submitForm, typeInto } from "./helpers/labelled-control";

afterEach(cleanupForm);

describe("create sponsorship form refusals", () => {
  it("refuses an empty organization selection beside the picker without a round trip, and keeps the draft", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    stubFetch(bodies);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });
    await settle();

    // A consortium sponsorship without an organization is refused by the
    // shared contract before anything is sent.
    await typeInto(controlFor(page, "Contact name"), "Example Contact");
    await submitForm(page);

    expect(bodies).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();

    // The picker draws no message slot of its own, so the refusal is
    // announced as an alert immediately beside it.
    const alerts = [...page.querySelectorAll('[role="alert"]')];
    expect(alerts.some((alert) => alert.textContent?.includes("organizationId is required"))).toBe(true);
    // The draft survives, so the refusal is a correction rather than a restart.
    expect(controlFor(page, "Contact name").value).toBe("Example Contact");
  });

  it("falls back to the raw id field for an account that cannot read the organization directory", async () => {
    // A sponsorship writer without `organizations:read` would only see the
    // picker fail; they keep the raw id input instead.
    portalSession.value = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "sponsorships:write", contextType: null, contextId: null }],
    });
    const bodies: unknown[] = [];
    const requests: string[] = [];
    stubFetch(bodies, 200, requests);
    installToastArea();
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });

    // The one field the contract refuses as empty is the one the markup
    // announces as required, in words as well as with a marker.
    const organization = controlFor(page, "Organization ID");
    expect(organization.required).toBe(true);
    expect(page.textContent).toContain("(required)");

    // The help text is not merely adjacent — it is pointed at.
    const describedBy = organization.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(page.querySelector(`#${describedBy!}`)?.textContent).toContain("member organization");

    // No directory query is made on behalf of an account that may not list it.
    expect(requests.some((request) => request.startsWith("GET /api/v1/organizations"))).toBe(false);

    await typeInto(organization, ORGANIZATION_ID);
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    const parsed = sponsorshipCreateSchema.parse(bodies[0]);
    expect(parsed).toMatchObject({ sponsorType: "consortium", organizationId: ORGANIZATION_ID });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("names a contract refusal on the fallback field itself without a round trip, and keeps the draft", async () => {
    portalSession.value = portalSessionFixture({ staff: true, staffRole: "user", grants: [] });
    const bodies: unknown[] = [];
    stubFetch(bodies);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });

    // An organization name is not an organization id; the shared contract
    // refuses it before anything is sent.
    await typeInto(controlFor(page, "Organization ID"), "Acme Widgets");
    await submitForm(page);

    expect(bodies).toEqual([]);
    expect(onCreated).not.toHaveBeenCalled();

    const organization = controlFor(page, "Organization ID");
    expect(organization.getAttribute("aria-invalid")).toBe("true");
    const describedBy = organization.getAttribute("aria-describedby");
    const message = page.querySelector(`#${describedBy!}`);
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toBeTruthy();
    // The draft survives, so the refusal is a correction rather than a restart.
    expect(organization.value).toBe("Acme Widgets");
  });

  it("lands the server's validation details on the fields they name, per the shared details contract", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if ((init?.method ?? "GET") === "GET" && url.pathname === "/api/v1/organizations") {
          return new Response(JSON.stringify(organizationsPage()), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid request",
              details: { formErrors: [], fieldErrors: { tier: ["This tier is not configured"] } },
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const page = mountForm();
    await settle();

    await chooseComboboxOption(page, "Member organization", ORGANIZATION_ID);
    await typeInto(controlFor(page, "Tier"), "Unobtainium");
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    const tier = controlFor(page, "Tier");
    expect(tier.getAttribute("aria-invalid")).toBe("true");
    const describedBy = tier.getAttribute("aria-describedby");
    expect(page.querySelector(`#${describedBy!}`)?.textContent).toContain("This tier is not configured");
  });

  it("announces a refusal as an alert, in English rather than transport phrasing, and keeps the draft", async () => {
    signInAsDirectoryReader();
    const bodies: unknown[] = [];
    stubFetch(bodies, 403);
    const onCreated = vi.fn();
    const page = mountForm({ onCreated });
    await settle();

    await chooseComboboxOption(page, "Member organization", ORGANIZATION_ID);
    await typeInto(controlFor(page, "Contact name"), "Example Contact");
    await submitForm(page);

    expect(bodies).toHaveLength(1);
    const alert = page.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("You don't have access to this");
    expect(page.textContent).not.toContain("HTTP 403");

    // A refusal is a retry, not a restart: the draft survives and the form is
    // usable again — the chosen organization still reads back by name.
    expect(onCreated).not.toHaveBeenCalled();
    expect(controlFor(page, "Member organization").value).toBe("Example Organization");
    expect(controlFor(page, "Contact name").value).toBe("Example Contact");
    expect(page.querySelector("fieldset")?.disabled).toBe(false);
    expect(buttonNamed(page, "Create").getAttribute("aria-busy")).toBeNull();
  });
});
