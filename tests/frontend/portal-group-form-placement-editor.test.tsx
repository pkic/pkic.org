// @vitest-environment jsdom
/**
 * The availability editor for one form placement: what it sends, what it says
 * when the save is refused, and what it promises a reader who cannot see it.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormPlacement } from "../../assets/shared/schemas/forms";
import { groupFormPlacementUpdateSchema } from "../../assets/shared/schemas/group-forms";
import { GroupFormPlacementEditor } from "../../assets/ts/member-flows/portal/sections/management/GroupFormPlacementEditor";
import { localDateTimeValue } from "../../assets/ts/shared/ui";
import { beginRecordEdit } from "./helpers/record-edit";
import { buttonNamed, controlFor, labelNames, submitForm, typeInto } from "./helpers/labelled-control";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const FORM_ID = "80000000-0000-4000-8000-000000000001";
const PLACEMENT_ID = "80000000-0000-4000-8000-000000000002";
const mounted: HTMLElement[] = [];

const placement: FormPlacement = {
  id: PLACEMENT_ID,
  formId: FORM_ID,
  ownerGroupId: GROUP_ID,
  contextType: "group",
  contextRef: GROUP_ID,
  audience: "Working group members",
  active: true,
  opensAt: "2026-09-01T09:00:00.000Z",
  closesAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

function definitionResponse(overrides: Partial<FormPlacement> = {}) {
  return {
    form: {
      id: FORM_ID,
      key: "architecture-survey",
      purpose: "survey",
      status: "active",
      title: "Architecture survey",
      description: null,
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    placement: { ...placement, ...overrides },
    capabilities: ["manage"],
    acceptingResponses: true,
    fields: [],
  };
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("group form placement availability editor", () => {
  it("opens as facts and restores the saved window when editing is cancelled", async () => {
    const container = mount(
      <GroupFormPlacementEditor groupId={GROUP_ID} placement={placement} onSaved={() => undefined} />,
    );
    expect(container.querySelector("input")).toBeNull();
    expect(container.textContent).toContain("Working group members");
    await beginRecordEdit(container, "Form availability actions");
    await typeInto(controlFor(container, "Audience"), "Unsaved audience");
    await act(async () => buttonNamed(container, "Cancel").click());
    expect(container.querySelector("input")).toBeNull();
    await beginRecordEdit(container, "Form availability actions");
    expect(controlFor(container, "Audience").value).toBe(placement.audience);
  });

  it("sends one canonical placement-policy update built from the visible controls", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({
          url,
          method: init.method ?? "GET",
          body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
        });
        return json(definitionResponse({ audience: "Everyone in the group", active: false }));
      }),
    );

    const saved = vi.fn();
    const container = mount(<GroupFormPlacementEditor groupId={GROUP_ID} placement={placement} onSaved={saved} />);
    await beginRecordEdit(container, "Form availability actions");

    await typeInto(controlFor(container, "Audience"), "Everyone in the group");
    const accepting = controlFor(container, "Accept responses while within the availability window");
    await act(() => accepting.click());
    await submitForm(container);

    const update = requests.find(({ method }) => method === "PATCH");
    expect(update?.url.pathname).toBe(`/api/v1/groups/${GROUP_ID}/forms/${PLACEMENT_ID}`);
    // Parsed through the shared request contract rather than compared to a
    // literal, so the assertion fails when the wire shape stops being valid.
    const parsed = groupFormPlacementUpdateSchema.parse(update?.body);
    expect(parsed).toMatchObject({
      audience: "Everyone in the group",
      active: false,
      opensAt: placement.opensAt,
      closesAt: null,
    });
    expect(saved).toHaveBeenCalledTimes(1);
  });

  it("names every control it asks for and links each label to the control it names", async () => {
    const container = mount(
      <GroupFormPlacementEditor groupId={GROUP_ID} placement={placement} onSaved={() => undefined} />,
    );
    await beginRecordEdit(container, "Form availability actions");

    expect(labelNames(container)).toEqual([
      "Audience",
      "Opens",
      "Closes",
      "Accept responses while within the availability window",
    ]);

    const audience = controlFor(container, "Audience");
    expect(audience.id).not.toBe("");
    expect(audience.required).toBe(true);
    // The help text is announced with the control rather than sitting beside it
    // as unlinked prose.
    const describedBy = audience.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(container.querySelector(`[id="${describedBy}"]`)?.textContent).toContain("Who this form is offered to");

    const accepting = controlFor(container, "Accept responses while within the availability window");
    expect(accepting.type).toBe("checkbox");
    expect(accepting.checked).toBe(true);
    // A checkbox needs all three parts of the pattern; the label alone renders
    // an operating-system default control.
    expect(accepting.classList.contains("pk-check__input")).toBe(true);
    expect(accepting.closest("label")?.classList.contains("pk-check")).toBe(true);
    expect(accepting.closest("label")?.querySelector(".pk-check__label")).not.toBeNull();

    expect(controlFor(container, "Opens").type).toBe("datetime-local");
    expect(controlFor(container, "Closes").type).toBe("datetime-local");
  });

  it("shows the window on the reader's clock and sends it back as UTC", async () => {
    const requests: Array<{ body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push({ body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
        return json(definitionResponse());
      }),
    );

    const container = mount(
      <GroupFormPlacementEditor groupId={GROUP_ID} placement={placement} onSaved={() => undefined} />,
    );
    await beginRecordEdit(container, "Form availability actions");

    // The control speaks a wall clock with no zone attached, so the stored
    // instant arrives converted into the reader's own.
    const opens = controlFor(container, "Opens");
    expect(opens.value).toBe(localDateTimeValue(placement.opensAt!));
    expect(opens.value).not.toContain("Z");

    // Whatever the reader types goes back out as UTC with millisecond
    // precision, which is the only shape the contract admits.
    const closesLocal = localDateTimeValue("2026-12-01T15:30:00.000Z");
    await typeInto(controlFor(container, "Closes"), closesLocal);
    await submitForm(container);

    const parsed = groupFormPlacementUpdateSchema.parse(requests.at(-1)?.body);
    expect(parsed.closesAt).toBe("2026-12-01T15:30:00.000Z");
  });

  it("refuses a close before an open through the contract, on the closing field", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        sent.push(init.body);
        return json(definitionResponse());
      }),
    );

    const container = mount(
      <GroupFormPlacementEditor groupId={GROUP_ID} placement={placement} onSaved={() => undefined} />,
    );
    await beginRecordEdit(container, "Form availability actions");

    // An hour before the placement opens.
    await typeInto(controlFor(container, "Closes"), localDateTimeValue("2026-09-01T08:00:00.000Z"));
    await submitForm(container);

    // Nothing left the browser: the same schema the route parses refused it
    // first, and said so where the reader is looking.
    expect(sent).toHaveLength(0);
    const closes = controlFor(container, "Closes");
    expect(closes.getAttribute("aria-invalid")).toBe("true");
    const describedBy = closes.getAttribute("aria-describedby") ?? "";
    const messages = describedBy
      .split(/\s+/)
      .map((id) => container.querySelector(`[id="${id}"]`)?.textContent ?? "")
      .join(" ");
    expect(messages).toContain("Closing time must be after opening time");
  });

  it("announces a refused save as an alert and leaves the form editable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: { code: "FORM_PLACEMENT_CONFLICT", message: "Closing time must be after opening time" } }, 409),
      ),
    );

    const saved = vi.fn();
    const container = mount(<GroupFormPlacementEditor groupId={GROUP_ID} placement={placement} onSaved={saved} />);
    await beginRecordEdit(container, "Form availability actions");
    await submitForm(container);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Closing time must be after opening time");
    expect(saved).not.toHaveBeenCalled();
    // The save failed, so the controls come back out of the disabled fieldset
    // and the submit is reachable again.
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
    expect(buttonNamed(container, "Save availability").disabled).toBe(false);
  });
});
