// @vitest-environment jsdom
/**
 * The group-settings form after its move onto the design system.
 *
 * The Bootstrap version labelled its controls with bare `form-label` spans
 * that pointed at hand-written ids, drew its checkboxes with `form-check`
 * alone, and reported both outcomes — the save and the failure — as coloured
 * `alert` divs. These assert what replaced them: every label bound to the
 * control it names, the checkbox parts all present so the drawn control is
 * the real one, and each outcome carrying a role rather than only a hue.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { groupSchema, groupSettingsDetailSchema, groupUpdateSchema } from "../../assets/shared/schemas/groups";
import { GroupSettingsForm } from "../../assets/ts/member-flows/portal/sections/management/GroupSettingsForm";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const GROUP_PATH = `/api/v1/groups/${GROUP_ID}`;

const record = {
  id: GROUP_ID,
  slug: "architecture",
  name: "Architecture Committee",
  type: { key: "committee", singularLabel: "Committee", pluralLabel: "Committees" },
  parentGroup: null,
  description: "Coordinates platform architecture.",
  links: ["https://github.com/pkic"],
  visibility: "participants",
  governanceInheritanceMode: "inherited",
  eligibilityMode: "managed",
  automaticEnrollmentMode: "none",
  allowAutomaticOptOut: false,
  publicLeadership: false,
  publicRoster: false,
  minEndorsersForBallot: 2,
  active: true,
  revision: 4,
  membershipCapacityCount: 4,
  representedMemberCount: 3,
  participantCount: 3,
  childCount: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
};

// The prop and the response are two different projections of one record, so
// each is built by the schema that owns it rather than by hand.
const group = groupSettingsDetailSchema.parse(record);
const saveResponse = { group: groupSchema.parse(record) };

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

/** Captures the PATCH body so it can be parsed through the shared contract. */
function stubPatch(respond: () => Response): { bodies: string[] } {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      expect(new URL(url, location.origin).pathname).toBe(GROUP_PATH);
      expect(init.method).toBe("PATCH");
      if (typeof init.body === "string") bodies.push(init.body);
      return respond();
    }),
  );
  return { bodies };
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** `useId` emits ids a CSS selector would have to escape, and jsdom has no `CSS.escape`. */
function byId(container: HTMLElement, id: string): HTMLElement | null {
  return [...container.querySelectorAll<HTMLElement>("[id]")].find((element) => element.id === id) ?? null;
}

function labelled(container: HTMLElement, text: string): HTMLElement[] {
  return [...container.querySelectorAll<HTMLLabelElement>("label.pk-field__label")]
    .filter((label) => (label.textContent ?? "").startsWith(text))
    .map((label) => byId(container, label.htmlFor))
    .filter((element): element is HTMLElement => element !== null);
}

async function save(container: HTMLElement): Promise<void> {
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("group settings form", () => {
  it("binds every label to the control it names and draws real choice controls", async () => {
    stubPatch(() => json(saveResponse));
    const container = mount(<GroupSettingsForm group={group} onUpdated={vi.fn(async () => undefined)} />);
    await settle();

    expect(container.querySelector("form")?.classList.contains("pk")).toBe(true);

    const labels = [...container.querySelectorAll<HTMLLabelElement>("label.pk-field__label")];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(byId(container, label.htmlFor), `label "${label.textContent ?? ""}" points at nothing`).not.toBeNull();
    }

    const [name] = labelled(container, "Name");
    expect((name as HTMLInputElement).value).toBe("Architecture Committee");
    expect((name as HTMLInputElement).required).toBe(true);
    // The asterisk is decorative; the word behind it is what is announced.
    expect(labels.find((label) => (label.textContent ?? "").startsWith("Name"))?.textContent).toContain("(required)");

    // The link editor is several controls, so it is named by a legend rather
    // than by a label with nothing to point at.
    const legends = [...container.querySelectorAll("legend")].map((legend) => legend.textContent);
    expect(legends).toContain("Links");

    // A `pk-check` label with no `pk-check__input` inside renders the
    // operating system's own control, which no gate can see.
    const checks = [...container.querySelectorAll("label.pk-check")];
    expect(checks).toHaveLength(4);
    for (const check of checks) {
      expect(check.querySelector("input.pk-check__input")).not.toBeNull();
      expect(check.querySelector(".pk-check__label")).not.toBeNull();
    }
    expect(container.querySelector(".form-check")).toBeNull();

    // Automatic enrollment is off, so opting out cannot apply. The control is
    // dimmed AND the reason is stated, so the state is not carried by the
    // dimming alone.
    const optOut = checks[0].querySelector<HTMLInputElement>("input.pk-check__input")!;
    expect(optOut.disabled).toBe(true);
    expect(checks[0].textContent).toContain("Available once automatic enrollment is set to something other than");
  });

  it("sends the shared update contract and announces the save in a live region", async () => {
    const onUpdated = vi.fn(async () => undefined);
    const { bodies } = stubPatch(() => json(saveResponse));
    const container = mount(<GroupSettingsForm group={group} onUpdated={onUpdated} />);
    await settle();

    const name = labelled(container, "Name")[0] as HTMLInputElement;
    name.value = "Architecture and Design Committee";
    void act(() => {
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await save(container);

    expect(bodies).toHaveLength(1);
    // The request is what the shared schema says it is, not what a literal
    // comparison in this file says it is.
    const sent = groupUpdateSchema.parse(JSON.parse(bodies[0]));
    expect(sent.name).toBe("Architecture and Design Committee");
    expect(sent.expectedRevision).toBe(4);
    expect(sent.links).toEqual(["https://github.com/pkic"]);
    expect(onUpdated).toHaveBeenCalledTimes(1);

    const saved = container.querySelector(".pk-alert--ok");
    expect(saved?.getAttribute("role")).toBe("status");
    expect(saved?.textContent).toContain("Group settings updated.");
  });

  it("reports a rejected save as an alert and leaves the form usable", async () => {
    const onUpdated = vi.fn(async () => undefined);
    stubPatch(() => json({ error: { code: "CONFLICT", message: "Revision mismatch" } }, 409));
    const container = mount(<GroupSettingsForm group={group} onUpdated={onUpdated} />);
    await settle();
    await save(container);

    const alert = container.querySelector(".pk-alert--danger");
    expect(alert?.getAttribute("role")).toBe("alert");
    // The server's sentence reaches the reader; its status and machine code
    // do not.
    expect(alert?.textContent).toContain("Revision mismatch");
    expect(alert?.textContent).not.toContain("409");
    expect(alert?.textContent).not.toContain("CONFLICT");

    expect(onUpdated).not.toHaveBeenCalled();
    expect(container.querySelector(".pk-alert--ok")).toBeNull();

    // The save stopped, so the form is out of its busy state and can be
    // corrected and retried.
    const submit = container.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(submit?.getAttribute("aria-busy")).toBeNull();
    expect(container.querySelector<HTMLFieldSetElement>("fieldset.pk-fieldset")?.disabled).toBe(false);
  });
});
