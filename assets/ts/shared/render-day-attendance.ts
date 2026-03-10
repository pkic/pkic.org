import type { EventFormsResponse } from "./types";

// Open-ended: any string matching a configured option value.
export type DayAttendanceType = string;

export interface DayAttendanceValue {
  dayDate: string;
  attendanceType: DayAttendanceType;
}

type EventDay = EventFormsResponse["eventDays"][number];

interface OptionConfig {
  /** SVG path(s) for a 16×16 Bootstrap-style viewBox, white fill on coloured bg. */
  icon: string;
  /** CSS colour used for the icon pill background, border accent, and radio fill. */
  color: string;
  /** Short human description shown beneath the option label. */
  description: string;
}

/** Config for well-known attendance types. Extend as new types are added. */
const OPTION_CONFIG: Record<string, OptionConfig> = {
  in_person: {
    // Bootstrap Icons — geo-alt-fill
    icon: '<path fill-rule="evenodd" d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>',
    color: "#e05c3b",
    description: "Join us at the venue in person",
  },
  virtual: {
    // Bootstrap Icons — camera-video-fill
    icon: '<path fill-rule="evenodd" d="M0 5a2 2 0 0 1 2-2h7.5a2 2 0 0 1 1.983 1.738l3.11-1.382A1 1 0 0 1 16 4.269v7.462a1 1 0 0 1-1.406.913l-3.111-1.382A2 2 0 0 1 9.5 13H2a2 2 0 0 1-2-2z"/>',
    color: "#2b7de8",
    description: "Watch the live stream remotely",
  },
  on_demand: {
    // Bootstrap Icons — play-circle-fill
    icon: '<path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M6.79 5.093A.5.5 0 0 0 6 5.5v5a.5.5 0 0 0 .79.407l3.5-2.5a.5.5 0 0 0 0-.814z"/>',
    color: "#7b2be8",
    description: "Watch the recording at your convenience",
  },
};

/** Fallback for unknown/custom attendance types. */
const FALLBACK_CONFIG: OptionConfig = {
  // Bootstrap Icons — calendar-check-fill
  icon: '<path d="M4 .5a.5.5 0 0 0-1 0V1H2a2 2 0 0 0-2 2v1h16V3a2 2 0 0 0-2-2h-1V.5a.5.5 0 0 0-1 0V1H4zM16 14V5H0v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2m-5.146-5.146-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 0 1 .708-.708L7.5 10.793l2.646-2.647a.5.5 0 0 1 .708.708"/>',
  color: "#198754",
  description: "Select your attendance preference",
};

function labelForDay(day: EventDay): string {
  return day.label && day.label.trim().length > 0 ? day.label : day.dayDate;
}

function svg(paths: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">${paths}</svg>`;
}

function createOptionCards(day: EventDay, lowCapacityThreshold: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "event-flow-attendance-options";

  for (const [index, option] of day.attendanceOptions.entries()) {
    const config = OPTION_CONFIG[option.value] ?? FALLBACK_CONFIG;

    const input = document.createElement("input");
    input.type = "radio";
    input.className = "event-flow-attendance-input";
    input.name = `dayAttendance.${day.dayDate}`;
    input.value = option.value;
    input.id = `dayAttendance-${day.dayDate}-${option.value}`;
    if (index === 0) input.required = true;

    const label = document.createElement("label");
    label.className = "event-flow-attendance-card";
    label.htmlFor = input.id;
    label.style.setProperty("--option-color", config.color);

    // ── Icon pill ───────────────────────────────────────────────────────────
    const iconEl = document.createElement("span");
    iconEl.className = "event-flow-attendance-icon";
    iconEl.innerHTML = svg(config.icon);

    // ── Text block (title + description) ────────────────────────────────────
    const textEl = document.createElement("span");
    textEl.className = "event-flow-attendance-text";

    const titleEl = document.createElement("span");
    titleEl.className = "event-flow-attendance-title";
    titleEl.textContent = option.label;

    const descEl = document.createElement("span");
    descEl.className = "event-flow-attendance-desc";
    descEl.textContent = config.description;

    textEl.append(titleEl, descEl);

    // ── Limited-spots badge ──────────────────────────────────────────────────
    if (
      lowCapacityThreshold > 0 &&
      option.spotsRemainingPercent != null &&
      option.spotsRemainingPercent <= lowCapacityThreshold
    ) {
      const badge = document.createElement("span");
      badge.className = "event-flow-attendance-badge";
      badge.textContent = "Limited spots";
      badge.setAttribute("aria-label", "Limited spots remaining");
      textEl.append(badge);
    }

    // ── Custom radio indicator ───────────────────────────────────────────────
    const radioEl = document.createElement("span");
    radioEl.className = "event-flow-attendance-radio";
    radioEl.setAttribute("aria-hidden", "true");

    label.append(iconEl, textEl, radioEl);
    wrapper.append(input, label);
  }

  return wrapper;
}

export function renderDayAttendance(container: HTMLElement, days: EventFormsResponse["eventDays"]): void {
  const lowCapacityThreshold = Number(container.dataset.lowCapacityThreshold ?? 0);
  container.innerHTML = "";
  if (days.length === 0) {
    container.innerHTML = "<p class='form-text'>No per-day attendance required for this event.</p>";
    return;
  }

  for (const day of days) {
    const row = document.createElement("div");
    row.className = "event-flow-day mb-3";

    const title = document.createElement("p");
    title.className = "event-flow-day-label";
    title.textContent = labelForDay(day);

    row.append(title, createOptionCards(day, lowCapacityThreshold));
    container.append(row);
  }
}

export function readDayAttendance(form: HTMLFormElement): DayAttendanceValue[] {
  const fields = form.querySelectorAll<HTMLInputElement>("input[name^='dayAttendance.']:checked");
  return Array.from(fields).map((field) => ({
    dayDate: field.name.replace(/^dayAttendance\./, ""),
    attendanceType: field.value,
  }));
}

export function writeDayAttendance(form: HTMLFormElement, values: DayAttendanceValue[]): void {
  for (const value of values) {
    const field = form.querySelector<HTMLInputElement>(
      `input[name='dayAttendance.${value.dayDate}'][value='${value.attendanceType}']`,
    );
    if (field) {
      field.checked = true;
    }
  }
}
