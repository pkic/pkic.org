// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationPrivateContactDetails } from "../../assets/ts/member-flows/portal/sections/OrganizationPrivateContactDetails";
import { organizationContactDetailsUpdateSchema } from "../../assets/shared/schemas/organization-contact-details";
import { beginRecordEdit } from "./helpers/record-edit";
import { controlFor, typeInto } from "./helpers/labeled-control";

const organizationId = "00000000-0000-4000-8000-000000000251";
const userId = "00000000-0000-4000-8000-000000000252";
let container: HTMLDivElement;
let details: unknown;
let saved: unknown[];
let refusal = false;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing ${label} button`);
  return found;
}
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  details = null;
  saved = [];
  refusal = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = organizationContactDetailsUpdateSchema.parse(JSON.parse(String(init.body)));
        saved.push(body);
        if (refusal)
          return json(
            {
              error: {
                code: "CONTACT_DETAILS_CHANGED",
                message: "Contact details changed; reload before saving again",
              },
            },
            409,
          );
        details = {
          ...body,
          revision: body.revision + 1,
          updatedAt: "2026-10-17T12:00:00.000Z",
          updatedByUserId: userId,
        };
      }
      return json({ contactDetails: details });
    }),
  );
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
  vi.unstubAllGlobals();
});

describe("private organization contact panel", () => {
  it("adds validated private details and reloads the saved record", async () => {
    await act(() => render(<OrganizationPrivateContactDetails organizationId={organizationId} canWrite />, container));
    await settle();
    expect(container.textContent).toContain("No contact details yet");
    await act(() => button("Add contact details").click());
    const form = container.querySelector("form");
    expect(form?.noValidate).toBe(true);
    await typeInto(controlFor(container, "Organization email"), "invalid");
    await act(() => button("Save contact details").click());
    expect(saved).toHaveLength(0);
    expect(controlFor(container, "Organization email").getAttribute("aria-invalid")).toBe("true");
    await typeInto(controlFor(container, "Organization email"), "office@example.test");
    await typeInto(controlFor(container, "Street address"), "Line 1\nLine 2");
    await typeInto(controlFor(container, "City"), "Example City");
    await typeInto(controlFor(container, "State or region"), "DC");
    await typeInto(controlFor(container, "Postal code"), "20001");
    await typeInto(controlFor(container, "Country"), "United States");
    await act(() => button("Save contact details").click());
    await settle();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      email: "office@example.test",
      postalAddress: { lines: ["Line 1", "Line 2"], city: "Example City", region: "DC", postalCode: "20001" },
      countryCode: "US",
      revision: 0,
    });
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).toContain("office@example.test");
  });
  it("validates individual postal fields, restores them on edit, and clears an empty address", async () => {
    details = {
      email: null,
      phone: null,
      postalAddress: { lines: ["Street", "Suite 2"], city: "Example City", region: "DC", postalCode: "20001" },
      countryCode: null,
      revision: 1,
      updatedAt: "2026-10-17T12:00:00.000Z",
      updatedByUserId: userId,
    };
    await act(() => render(<OrganizationPrivateContactDetails organizationId={organizationId} canWrite />, container));
    await settle();
    expect(container.textContent).toContain("Example City");
    await beginRecordEdit(container, "Private contact details actions", "Edit contact details…");
    expect(controlFor(container, "Street address").value).toBe("Street\nSuite 2");
    expect(controlFor(container, "City").value).toBe("Example City");
    expect(controlFor(container, "State or region").value).toBe("DC");
    expect(controlFor(container, "Postal code").value).toBe("20001");
    await typeInto(controlFor(container, "City"), "a".repeat(201));
    await act(() => button("Save contact details").click());
    expect(saved).toHaveLength(0);
    expect(controlFor(container, "City").getAttribute("aria-invalid")).toBe("true");
    for (const label of ["Street address", "City", "State or region", "Postal code"]) {
      await typeInto(controlFor(container, label), "");
    }
    await act(() => button("Save contact details").click());
    await settle();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ postalAddress: null, revision: 1 });
    expect(container.textContent).toContain("No contact details yet");
  });
  it("keeps a refused draft open and lets the reader cancel it", async () => {
    details = {
      email: "office@example.test",
      phone: null,
      postalAddress: null,
      countryCode: null,
      revision: 3,
      updatedAt: "2026-10-17T12:00:00.000Z",
      updatedByUserId: userId,
    };
    await act(() => render(<OrganizationPrivateContactDetails organizationId={organizationId} canWrite />, container));
    await settle();
    await beginRecordEdit(container, "Private contact details actions", "Edit contact details…");
    await typeInto(controlFor(container, "Phone"), "+1 202 555 0100");
    refusal = true;
    await act(() => button("Save contact details").click());
    await settle();
    expect(container.querySelector("dialog[open]")).not.toBeNull();
    expect(container.textContent).toContain("reload before saving again");
    expect(controlFor(container, "Phone").value).toBe("+1 202 555 0100");
    await act(() => button("Cancel").click());
    expect(container.querySelector("dialog")).toBeNull();
  });
  it("shows read-only details without edit controls", async () => {
    await act(() =>
      render(<OrganizationPrivateContactDetails organizationId={organizationId} canWrite={false} />, container),
    );
    await settle();
    expect(container.textContent).toContain("No contact details yet");
    expect(container.querySelector("button")).toBeNull();
  });
});
