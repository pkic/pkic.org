// @vitest-environment jsdom
/**
 * The fields describing one meeting occurrence, shared by the create form and
 * the occurrence settings form.
 *
 * What is asserted here is what a visual review cannot see: that every control
 * is reachable through its own label's `for`/`id` pair, that those ids are
 * still the ones the caller chose through `idPrefix` — the contract its two
 * parent forms address the controls by — that the encryption note is attached
 * to the control it explains rather than floating beside it, and that a
 * replacement URL the reader has not typed blocks submission instead of
 * posting an empty string over a configured one.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EVENT_OCCURRENCE_STATUSES } from "../../assets/shared/schemas/event-series";
import {
  MeetingOccurrenceFields,
  type MeetingOccurrenceDraft,
} from "../../assets/ts/member-flows/portal/sections/management/MeetingOccurrenceFields";
import { chooseOption, controlFor, labelNames, typeInto } from "./helpers/labelled-control";

const ID_PREFIX = "meeting-occurrence-test";

function draft(overrides: Partial<MeetingOccurrenceDraft> = {}): MeetingOccurrenceDraft {
  return {
    startsAt: "2026-09-01T15:00",
    endsAt: "2026-09-01T16:00",
    status: "scheduled",
    location: "Room 1",
    providerUrlAction: "keep",
    providerJoinUrl: "",
    ...overrides,
  };
}

const mounted: HTMLElement[] = [];

function mount(node: ComponentChild): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

function mountFields(props: Partial<Parameters<typeof MeetingOccurrenceFields>[0]> = {}): HTMLElement {
  return mount(<MeetingOccurrenceFields idPrefix={ID_PREFIX} draft={draft()} onChange={vi.fn()} {...props} />);
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

describe("meeting occurrence fields", () => {
  it("names every control through its own label, and keeps the id its caller chose", () => {
    const page = mountFields({ existing: true, providerConfigured: true });

    // The id is not cosmetic here: both parent forms address these controls
    // by `idPrefix`, so a generated id would break them silently.
    expect(controlFor(page, "Starts").id).toBe(`${ID_PREFIX}-starts`);
    expect(controlFor(page, "Ends").id).toBe(`${ID_PREFIX}-ends`);
    expect(controlFor(page, "Status").id).toBe(`${ID_PREFIX}-status`);
    expect(controlFor(page, "Location override").id).toBe(`${ID_PREFIX}-location`);
    expect(controlFor(page, "Meeting-provider URL").id).toBe(`${ID_PREFIX}-provider-action`);
  });

  it("announces the two instants an occurrence cannot be without, and nothing as invalid up front", () => {
    const page = mountFields();

    const required = [...page.querySelectorAll<HTMLElement>("[required]")].map((control) => control.id);
    expect(required).toContain(`${ID_PREFIX}-starts`);
    expect(required).toContain(`${ID_PREFIX}-ends`);
    // A location override and a provider URL are both optional on a new
    // occurrence, so neither is marked.
    expect(required).not.toContain(`${ID_PREFIX}-location`);
    expect(required).not.toContain(`${ID_PREFIX}-provider-url`);
    // The marker is a word as well as a glyph.
    expect(page.textContent).toContain("(required)");
    expect(page.querySelector("[aria-invalid]")).toBeNull();
  });

  it("attaches the encryption note to the control it explains", () => {
    const page = mountFields({
      existing: true,
      providerConfigured: true,
      draft: draft({ providerUrlAction: "replace" }),
    });

    const url = controlFor(page, "Replacement URL");
    const describedBy = url.getAttribute("aria-describedby");
    expect(describedBy).toBe(`${ID_PREFIX}-provider-help`);
    expect(page.querySelector(`#${describedBy}`)?.textContent).toContain("encrypted and never returned by the API");
  });

  it("blocks a replacement the reader has not typed, and accepts one they have", async () => {
    const page = mountFields({
      existing: true,
      providerConfigured: true,
      draft: draft({ providerUrlAction: "replace" }),
    });

    // Choosing "replace" and leaving the field empty would otherwise post an
    // empty string over a configured URL.
    const url = controlFor<HTMLInputElement>(page, "Replacement URL");
    expect(url.required).toBe(true);
    expect(url.checkValidity()).toBe(false);

    url.value = "https://meet.example.test/room";
    expect(url.checkValidity()).toBe(true);

    // A value that is not a URL at all is refused by the control's own type.
    url.value = "not a url";
    expect(url.checkValidity()).toBe(false);
  });

  it("offers a status only on an occurrence that already exists", () => {
    expect(labelNames(mountFields())).not.toContain("Status");

    const existing = mountFields({ existing: true });
    const status = controlFor<HTMLSelectElement>(existing, "Status");
    expect([...status.options].map((option) => option.value)).toEqual([...EVENT_OCCURRENCE_STATUSES]);
  });

  it("offers the keep/replace/remove choice only once a provider URL is configured", () => {
    // Nothing configured: the reader is asked for a URL, not what to do with
    // one that does not exist.
    const fresh = mountFields({ existing: true });
    expect(labelNames(fresh)).toContain("Meeting-provider URL");
    expect(fresh.querySelector(`#${ID_PREFIX}-provider-action`)).toBeNull();
    expect(controlFor(fresh, "Meeting-provider URL").id).toBe(`${ID_PREFIX}-provider-url`);

    // Configured, and keeping it: the URL field is gone, because the stored
    // value is never returned and an empty box would read as "no URL".
    const keeping = mountFields({ existing: true, providerConfigured: true });
    expect(keeping.querySelector(`#${ID_PREFIX}-provider-url`)).toBeNull();
    expect(labelNames(keeping)).not.toContain("Replacement URL");
  });

  it("reports an edit through the callback rather than mutating the draft it was given", async () => {
    const onChange = vi.fn();
    const given = draft();
    const page = mount(<MeetingOccurrenceFields idPrefix={ID_PREFIX} draft={given} onChange={onChange} />);

    await typeInto(controlFor(page, "Location override"), "Room 2");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ location: "Room 2", startsAt: "2026-09-01T15:00" });
    expect(given.location).toBe("Room 1");
  });

  it("reports the provider-URL choice under the key the occurrence contract stores", async () => {
    const onChange = vi.fn();
    const page = mountFields({ existing: true, providerConfigured: true, onChange });

    await chooseOption(controlFor<HTMLSelectElement>(page, "Meeting-provider URL"), "remove");

    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ providerUrlAction: "remove" });
  });

  it("takes every control out of play while the form that holds it is saving", () => {
    const page = mountFields({ existing: true, providerConfigured: true, disabled: true });

    for (const label of ["Starts", "Ends", "Status", "Location override", "Meeting-provider URL"]) {
      expect(controlFor(page, label).matches(":disabled")).toBe(true);
    }
  });
});
