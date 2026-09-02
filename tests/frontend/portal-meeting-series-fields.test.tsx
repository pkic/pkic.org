// @vitest-environment jsdom
/**
 * The fields describing a recurring meeting series, shared by the create form
 * and the settings form.
 *
 * What is asserted here is what a visual review cannot see: that every
 * control is reachable through its own label's `for`/`id` pair, that the two
 * ways a field can be taken out of play — the whole form saving, and a
 * schedule already materialized into occurrences — reach exactly the controls
 * they should, and that an edit is reported through the callback rather than
 * written into the draft the component was handed.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EVENT_VISIBILITY_LABELS } from "../../assets/shared/schemas/event-series";
import {
  MeetingSeriesFields,
  type MeetingSeriesDraft,
} from "../../assets/ts/member-flows/portal/sections/management/MeetingSeriesFields";
import { chooseOption, controlFor, labelNames, typeInto } from "./helpers/labelled-control";

function draft(overrides: Partial<MeetingSeriesDraft> = {}): MeetingSeriesDraft {
  return {
    name: "Architecture call",
    profileKey: "meeting",
    startsAt: "2026-09-01T15:00",
    recurrenceRule: "FREQ=WEEKLY;INTERVAL=1",
    timezone: "Europe/Amsterdam",
    durationMinutes: 60,
    location: "Online",
    registrationPolicy: "no_registration",
    visibility: "group_members",
    memberEligibility: "owner_group",
    guestPolicy: "occurrence_invitation",
    ...overrides,
  };
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

function mountFields(props: Partial<Parameters<typeof MeetingSeriesFields>[0]> = {}): HTMLElement {
  return mount(<MeetingSeriesFields draft={draft()} onChange={vi.fn()} {...props} />);
}

/** The labels this component owns, without the ones its children bring. */
const OWN_LABELS = [
  "Meeting name",
  "Event profile",
  "First occurrence",
  "Duration (minutes)",
  "Registration",
  "Visibility",
  "Attendee eligibility",
  "External guests",
  "Location or public meeting page",
];

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
});

describe("meeting series fields", () => {
  it("names every control through its own label, and marks the ones a series cannot be without", () => {
    const page = mountFields();

    for (const label of OWN_LABELS) {
      // Resolved through the `for`/`id` pair itself, so the lookup fails
      // exactly when the labelling contract is broken.
      expect(controlFor(page, label).id).toBeTruthy();
    }
    // The child components still bring their own named controls.
    expect(labelNames(page)).toContain("Time zone");

    // A series with no name, no first occurrence and no length is not a
    // series, and those three are the three the markup announces as required.
    const required = [...page.querySelectorAll<HTMLElement>("[required]")].map((control) => control.id);
    expect(required).toContain(controlFor(page, "Meeting name").id);
    expect(required).toContain(controlFor(page, "First occurrence").id);
    expect(required).toContain(controlFor(page, "Duration (minutes)").id);
    expect(page.textContent).toContain("(required)");

    // Nothing is announced as invalid before anything has been checked.
    expect(page.querySelector("[aria-invalid]")).toBeNull();
  });

  it("shows each policy by the words it means rather than by its stored value", () => {
    const page = mountFields();

    const visibility = controlFor<HTMLSelectElement>(page, "Visibility");
    expect(visibility.value).toBe("group_members");
    expect(visibility.selectedOptions[0]?.textContent).toBe(EVENT_VISIBILITY_LABELS.group_members);

    const eligibility = controlFor<HTMLSelectElement>(page, "Attendee eligibility");
    expect(eligibility.selectedOptions[0]?.textContent).toBe("Owning group");

    const guests = controlFor<HTMLSelectElement>(page, "External guests");
    expect(guests.selectedOptions[0]?.textContent).toBe("Invite per occurrence");
  });

  it("reports an edit through the callback rather than mutating the draft it was given", async () => {
    const onChange = vi.fn();
    const given = draft();
    const page = mount(<MeetingSeriesFields draft={given} onChange={onChange} />);

    await typeInto(controlFor(page, "Meeting name"), "Renamed call");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ name: "Renamed call", location: "Online" });
    expect(given.name).toBe("Architecture call");
  });

  it("reports a duration as a number, which is what the series contract stores", async () => {
    const onChange = vi.fn();
    const page = mountFields({ onChange });

    await typeInto(controlFor(page, "Duration (minutes)"), "90");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ durationMinutes: 90 });
    // A text input hands back a string; the draft must not carry one.
    expect(typeof (onChange.mock.calls[0]?.[0] as MeetingSeriesDraft).durationMinutes).toBe("number");
  });

  it("reports a policy change under the key it belongs to", async () => {
    const onChange = vi.fn();
    const page = mountFields({ onChange });

    await chooseOption(controlFor<HTMLSelectElement>(page, "Attendee eligibility"), "public");

    expect(onChange.mock.calls[0]?.[0]).toMatchObject({
      memberEligibility: "public",
      guestPolicy: "occurrence_invitation",
    });
  });

  it("takes every control out of play while the form that holds it is saving", () => {
    const page = mountFields({ disabled: true });

    for (const label of OWN_LABELS) {
      expect(controlFor(page, label).matches(":disabled")).toBe(true);
    }
    expect(controlFor(page, "Time zone").matches(":disabled")).toBe(true);
  });

  it("locks only the schedule once occurrences exist, leaving the mutable policy editable", () => {
    const page = mountFields({ scheduleLocked: true });

    // The schedule is what generated occurrences depend on, so it is what
    // freezes — including the two controls the child components own.
    for (const label of ["First occurrence", "Duration (minutes)"]) {
      expect(controlFor(page, label).matches(":disabled")).toBe(true);
    }
    expect(controlFor(page, "Time zone").matches(":disabled")).toBe(true);
    expect(controlFor(page, "Repeats").matches(":disabled")).toBe(true);

    // Everything else stays editable: a locked schedule is not a locked
    // series.
    for (const label of [
      "Meeting name",
      "Event profile",
      "Registration",
      "Visibility",
      "Attendee eligibility",
      "External guests",
      "Location or public meeting page",
    ]) {
      expect(controlFor(page, label).matches(":disabled")).toBe(false);
    }
  });
});
