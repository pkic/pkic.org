// @vitest-environment jsdom
/**
 * The shared start/end/timezone row.
 *
 * The caller owns each control's `id` — every consumer passes an `idPrefix`
 * and addresses these controls by it — so what is worth asserting is that the
 * label and the id the caller chose still agree, that the required control is
 * marked in words as well as with an asterisk, and that an empty required
 * value is refused by the platform rather than quietly accepted.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventScheduleFields } from "../../assets/ts/components/EventScheduleFields";
import { controlFor } from "./helpers/labelled-control";

const mounted: HTMLElement[] = [];

function mount(node: Parameters<typeof render>[0]): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("event schedule fields", () => {
  it("binds every schedule label to the control the caller named, and marks the required one", () => {
    const container = mount(
      <EventScheduleFields
        startsAt="2026-09-01T09:00"
        endsAt="2026-09-01T17:00"
        timezone="Europe/Amsterdam"
        idPrefix="event-general"
        onStartsAtChange={vi.fn()}
        onEndsAtChange={vi.fn()}
        onTimezoneChange={vi.fn()}
      />,
    );

    // Resolved through the `for`/`id` pair, so the lookup fails exactly when
    // the caller's id and the label stop agreeing.
    expect(controlFor(container, "Start date").id).toBe("event-general-starts-at");
    expect(controlFor(container, "End date").id).toBe("event-general-ends-at");
    const timezone = controlFor(container, "Timezone");
    expect(timezone.id).toBe("event-general-timezone");
    expect(timezone.hasAttribute("required")).toBe(true);
    // The asterisk is decorative; the word behind it is what is announced.
    const marker = container.querySelector(".pk-field__required");
    expect(marker?.querySelector('[aria-hidden="true"]')?.textContent).toBe("*");
    expect(marker?.querySelector(".pk-field__sr")?.textContent).toBe("(required)");
  });

  it("reports an empty timezone as invalid through the platform rather than accepting it", () => {
    const container = mount(
      <EventScheduleFields
        startsAt=""
        endsAt=""
        timezone=""
        idPrefix="event-general"
        timezonePlaceholder="Europe/Amsterdam"
        onStartsAtChange={vi.fn()}
        onEndsAtChange={vi.fn()}
        onTimezoneChange={vi.fn()}
      />,
    );

    // `required` on a real input means the browser blocks the submit and names
    // the control, rather than a script re-deriving that after the fact.
    const timezone = controlFor(container, "Timezone");
    expect(timezone.checkValidity()).toBe(false);
    // A placeholder is a hint, never the control's name.
    expect(timezone.getAttribute("placeholder")).toBe("Europe/Amsterdam");
    expect(controlFor(container, "Start date").checkValidity()).toBe(true);
  });

  it("reports every event schedule field through the shared editor", () => {
    const onStartsAtChange = vi.fn();
    const onEndsAtChange = vi.fn();
    const onTimezoneChange = vi.fn();
    const container = mount(
      <EventScheduleFields
        startsAt="2026-09-01T09:00"
        endsAt="2026-09-01T17:00"
        timezone="Europe/Amsterdam"
        onStartsAtChange={onStartsAtChange}
        onEndsAtChange={onEndsAtChange}
        onTimezoneChange={onTimezoneChange}
      />,
    );
    const inputs = [...container.querySelectorAll("input")];
    for (const [input, value] of inputs.map(
      (input, index) => [input, ["2026-10-01T10:00", "2026-10-01T18:00", "UTC"][index]] as const,
    )) {
      input.value = value;
      void act(() => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(onStartsAtChange).toHaveBeenCalledWith("2026-10-01T10:00");
    expect(onEndsAtChange).toHaveBeenCalledWith("2026-10-01T18:00");
    expect(onTimezoneChange).toHaveBeenCalledWith("UTC");
  });
});
