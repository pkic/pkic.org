// @vitest-environment jsdom
/**
 * The three ways a form's answers are read: one person's answers as a list,
 * everyone's as a page of rows, and everyone's as a per-field breakdown.
 *
 * What is asserted here is what a visual review cannot see. Every value is
 * tied to its own term; every chart, bar and control carries a name that says
 * which field it belongs to, because a page of these otherwise offers a column
 * of controls all called the same thing; and a refused load replaces the table
 * rather than letting "No responses found" claim something the surface does
 * not know.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  formSubmissionsQuerySchema,
  formSubmissionsExportQuerySchema,
} from "../../assets/shared/schemas/form-management";
import type { FormSubmission } from "../../assets/shared/schemas/form-management";
import type { FormFieldDefinition } from "../../assets/shared/schemas/forms";
import { VISUALIZATIONS } from "../../assets/shared/schemas/form-field-rules";
import { parseFormFieldOptions } from "../../assets/shared/schemas/form-field-rules";
import { buildFormAnswerRows, formatFormAnswerValue } from "../../assets/ts/components/forms/form-answers";
import { FormResponseStats, type ServerFieldStat } from "../../assets/ts/components/forms/FormResponseStats";
import { FormAnswerTable, FormSubmissionsTable } from "../../assets/ts/components/forms/FormResponseViews";

const NOW = "2026-08-31T09:00:00.000Z";
const mounted: HTMLElement[] = [];

function field(overrides: Partial<FormFieldDefinition> = {}): FormFieldDefinition {
  return {
    id: "90000000-0000-4000-8000-000000000001",
    key: "priority",
    label: "Priority",
    fieldType: "select",
    required: false,
    options: [
      { value: "high", label: "High" },
      { value: "low", label: "Low" },
    ],
    optionSource: null,
    validation: null,
    sortOrder: 10,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  } as FormFieldDefinition;
}

function submission(overrides: Partial<FormSubmission> = {}): FormSubmission {
  return {
    id: "a0000000-0000-4000-8000-000000000001",
    status: "submitted",
    submittedAt: NOW,
    contextType: "group",
    contextRef: null,
    submitter: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.test" },
    answers: { priority: "high" },
    ...overrides,
  } as FormSubmission;
}

const submissionsSchema = z.object({
  submissions: z.array(z.unknown()),
  page: z.object({ limit: z.number(), offset: z.number(), total: z.number(), hasMore: z.boolean() }),
}) as unknown as z.ZodType<{
  submissions: FormSubmission[];
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}>;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChild): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The `dd` that answers the term reading `term`. */
function valueOf(root: ParentNode, term: string): HTMLElement {
  const dt = [...root.querySelectorAll("dt")].find((candidate) => candidate.textContent === term);
  if (!dt) throw new Error(`no term reads "${term}"`);
  const dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== "DD") throw new Error(`term "${term}" is followed by no value`);
  return dd as HTMLElement;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("form answer rows", () => {
  it("resolves stored option values to their labels and keeps unlisted keys", () => {
    expect(formatFormAnswerValue("high", field())).toEqual(["High"]);
    expect(formatFormAnswerValue(["high", "unknown"], field())).toEqual(["High", "unknown"]);
    // An absent answer is a dash rather than the string "undefined".
    expect(formatFormAnswerValue(undefined, field())).toEqual(["-"]);
    expect(formatFormAnswerValue([], field())).toEqual(["-"]);
  });

  it("uses the canonical option labels and date-range wording in every answer view", () => {
    const dietary = field({
      options: parseFormFieldOptions(["gluten_free", "nut_allergy", { value: "custom_value", label: "Custom label" }]),
    });
    expect(formatFormAnswerValue(["gluten_free", "nut_allergy", "custom_value"], dietary)).toEqual([
      "Gluten free",
      "Nut allergy",
      "Custom label",
    ]);
    expect(formatFormAnswerValue({ start: "2026-12-01", end: "2026-12-03" })).toEqual(["2026-12-01 to 2026-12-03"]);
    expect(formatFormAnswerValue({ start: "", end: "2026-12-03" })).toEqual(["-"]);
  });

  it("reads a stored country code as the country's name", () => {
    const country = field({ validation: { format: "iso_country" } } as Partial<FormFieldDefinition>);
    expect(formatFormAnswerValue("NL", country)).toEqual(["Netherlands"]);
    expect(formatFormAnswerValue("zz", country)).toEqual(["zz"]);
  });

  it("keeps answers to fields the definition no longer lists", () => {
    const rows = buildFormAnswerRows({ priority: "high", retired_question: "kept" }, [field()]);
    expect(rows.map((row) => row.key)).toEqual(["priority", "retired_question"]);
    // The label falls back to the key rather than the row disappearing.
    expect(rows[1].label).toBe("retired_question");
  });
});

describe("one submission's answers", () => {
  it("pairs every value with its own term rather than announcing a grid", () => {
    const page = mount(
      <FormAnswerTable
        answers={{ priority: "high", tags: ["a", "b"], raw: { nested: 1 } }}
        fields={[field(), field({ key: "tags", label: "Tags", fieldType: "multi_select", options: null })]}
      />,
    );

    const list = page.querySelector("dl")!;
    // The pairs are direct children of the list — a wrapper between them would
    // take both out of the two-column grid.
    expect(list.querySelectorAll(":scope > dt")).toHaveLength(3);
    expect(list.querySelectorAll(":scope > dd")).toHaveLength(3);
    expect(valueOf(page, "Priority").textContent).toBe("High");
    expect(valueOf(page, "Tags").querySelectorAll("li")).toHaveLength(2);
    expect(valueOf(page, "raw").querySelector("pre")).toBeTruthy();

    // Not a table at all, so no unnamed grid is announced inside the named one
    // this renders in.
    expect(page.querySelector("table")).toBeNull();
  });

  it("says nothing was recorded instead of rendering an empty list", () => {
    const page = mount(<FormAnswerTable answers={{}} fields={[field()]} />);
    expect(page.querySelector("dl")).toBeNull();
    expect(page.textContent).toBe("No form answers recorded.");
  });
});

describe("the submissions table", () => {
  it("names every row control after the response it opens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ submissions: [submission()], page: { limit: 50, offset: 0, total: 1, hasMore: false } }),
      ),
    );
    const onOpen = vi.fn();
    const page = mount(
      <FormSubmissionsTable
        fields={[field()]}
        endpoint="/api/v1/forms/f/submissions"
        responseSchema={submissionsSchema}
        onOpen={onOpen}
      />,
    );
    await settle();

    // The table names itself among the tables on the page.
    expect(page.querySelector("caption")?.textContent).toBe("Form responses");

    const menu = page.querySelector('button[aria-label="Actions for Ada Lovelace"]') as HTMLButtonElement;
    expect(menu).toBeTruthy();
    await act(() => menu.click());
    const open = [...document.querySelectorAll("button")].find((button) => button.textContent === "Open response")!;
    await act(() => open.click());
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "a0000000-0000-4000-8000-000000000001" }));
  });

  it("sends answer filters to the server and exports the selected field across all pages", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requests.push(new URL(url, "https://example.test"));
        return json({ submissions: [submission()], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
      }),
    );
    const page = mount(
      <FormSubmissionsTable
        fields={[field()]}
        endpoint="/api/v1/events/pqc/forms/f/submissions"
        exportEndpoint="/api/v1/events/pqc/forms/f/submissions/exports"
        params={{ status: "registered", attendanceType: "in_person" }}
        responseSchema={submissionsSchema}
        onOpen={vi.fn()}
      />,
    );
    await settle();
    const choose = async (label: string, value: string) => {
      const select = page.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
      expect(select).toBeTruthy();
      await act(() => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await settle();
    };
    await choose("Filter answer field", "priority");
    await choose("Filter Priority", "high");
    const query = formSubmissionsQuerySchema.parse(Object.fromEntries(requests.at(-1)!.searchParams));
    expect(query.answerField).toBe("priority");
    expect(query.answerValue).toBe("high");
    expect(query.status).toBe("registered");
    const link = page.querySelector<HTMLAnchorElement>('a[aria-label="Download Priority (CSV)"]')!;
    expect(link).toBeTruthy();
    const url = new URL(link.href);
    expect(url.pathname).toBe("/api/v1/events/pqc/forms/f/submissions/exports");
    const exported = formSubmissionsExportQuerySchema.parse(Object.fromEntries(url.searchParams));
    expect(exported.answerField).toBe(query.answerField);
    expect(exported.answerValue).toBe(query.answerValue);
    expect(exported.field).toBe("priority");
    expect(exported.attendanceType).toBe("in_person");
    expect(url.searchParams.has("limit")).toBe(false);
    expect(url.searchParams.has("offset")).toBe(false);
    await choose("Filter answer field", "");
    const cleared = formSubmissionsQuerySchema.parse(Object.fromEntries(requests.at(-1)!.searchParams));
    expect(cleared.answerValue).toBeUndefined();
  });

  it.each([
    { name: "a caller scope alone", filtered: false, expected: "Nothing has been submitted through this form yet." },
    { name: "a page-level filter", filtered: true, expected: "Try changing your search or filters." },
  ])("explains empty responses with $name", async ({ filtered, expected }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ submissions: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    const page = mount(
      <FormSubmissionsTable
        fields={[field()]}
        endpoint="/api/v1/forms/f/submissions"
        // Scope parameters the table does not know about never read as the reader's filters.
        params={{ eventSlug: "pqc-2026", groupScope: "board", ...(filtered ? { status: "submitted" } : {}) }}
        filtered={filtered}
        responseSchema={submissionsSchema}
        onOpen={vi.fn()}
      />,
    );
    await settle();
    expect(page.textContent).toContain(expected);
  });

  it("exports the remaining column when another column with the same label is hidden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ submissions: [submission()], page: { limit: 50, offset: 0, total: 1, hasMore: false } }),
      ),
    );
    const notes = { fieldType: "text" as const, label: "Notes", options: null };
    const page = mount(
      <FormSubmissionsTable
        fields={[
          field({ ...notes, id: "90000000-0000-4000-8000-000000000002", key: "notes_a" }),
          field({ ...notes, id: "90000000-0000-4000-8000-000000000003", key: "notes_b" }),
        ]}
        endpoint="/api/v1/events/pqc/forms/f/submissions"
        exportEndpoint="/api/v1/events/pqc/forms/f/submissions/exports"
        responseSchema={submissionsSchema}
        onOpen={vi.fn()}
      />,
    );
    await settle();
    const trigger = page.querySelector<HTMLButtonElement>('button[aria-label="Notes column options"]')!;
    await act(() => trigger.click());
    const hide = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find(
      (button) => button.textContent!.trim() === "Hide column",
    )!;
    await act(() => hide.click());
    await settle();
    const link = page.querySelector<HTMLAnchorElement>('a[aria-label="Download responses (CSV)"]')!;
    const exported = formSubmissionsExportQuerySchema.parse(Object.fromEntries(new URL(link.href).searchParams));
    expect(exported.columns).toEqual(["submitter", "answer:notes_b", "submitted_at", "status"]);
  });

  it("keeps a refused bookmarked query visible and disables its CSV download", async () => {
    const previous = window.location.href;
    window.history.replaceState(null, "", "#?form-responses.sort=unknown");
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => json({ error: { code: "INVALID_QUERY", message: "Unknown sort column" } }, 400)),
      );
      const page = mount(
        <FormSubmissionsTable
          fields={[field()]}
          endpoint="/api/v1/events/pqc/forms/f/submissions"
          exportEndpoint="/api/v1/events/pqc/forms/f/submissions/exports"
          responseSchema={submissionsSchema}
          onOpen={vi.fn()}
        />,
      );
      await settle();
      expect(page.querySelector('[role="alert"]')?.textContent).toContain("Unknown sort column");
      expect(page.querySelector<HTMLButtonElement>('button[aria-label="Download responses (CSV)"]')?.disabled).toBe(
        true,
      );
    } finally {
      window.history.replaceState(null, "", previous);
    }
  });

  it("replaces the table with the failure rather than claiming there are no responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "Responses are not visible to you." } }, 403)),
    );
    const page = mount(
      <FormSubmissionsTable
        fields={[field()]}
        endpoint="/api/v1/forms/f/submissions"
        responseSchema={submissionsSchema}
        onOpen={vi.fn()}
      />,
    );
    await settle();

    expect(page.textContent).not.toContain("No responses found");
    // The error is announced, not merely colored.
    const alert = page.querySelector('[role="alert"]');
    expect(alert).toBeTruthy();
    expect(alert?.textContent).toContain("Responses are not visible to you.");
  });
});

describe("the per-field breakdown", () => {
  const stats: ServerFieldStat[] = [
    {
      fieldKey: "priority",
      totalAnswers: 4,
      uniqueAnswers: 2,
      entries: [
        { label: "High", count: 3, percent: 75, weight: 1 },
        { label: "Low", count: 1, percent: 25, weight: 0.3 },
      ],
    },
  ];

  it("names the card, the bars, the picker and the expand control after their field", () => {
    const page = mount(
      <FormResponseStats fields={[field({ fieldType: "select", options: null })]} stats={stats} total={4} />,
    );

    expect(page.querySelector("section")?.getAttribute("aria-label")).toBe("Priority");
    expect(page.querySelector('select[aria-label="Presentation for Priority"]')).toBeTruthy();
    expect(page.querySelector('button[aria-label="Expand Priority chart"]')).toBeTruthy();
  });

  it("dismisses an expanded chart only for a complete backdrop gesture or Escape", async () => {
    const page = mount(
      <FormResponseStats fields={[field({ fieldType: "select", options: null })]} stats={stats} total={4} />,
    );
    const expand = () => page.querySelector<HTMLButtonElement>('button[aria-label="Expand Priority chart"]')!.click();
    const overlay = () => page.querySelector<HTMLElement>('[role="dialog"]');
    const pointer = (target: Element, type: string, id = 1) => {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, "pointerId", { value: id });
      target.dispatchEvent(event);
    };
    await act(expand);
    const panel = overlay()!.querySelector(".adm-stat-modal")!;
    await act(() => {
      pointer(panel, "pointerdown");
      pointer(overlay()!, "pointerup");
    });
    await act(() => {
      pointer(overlay()!, "pointerdown");
      pointer(panel, "pointerup");
    });
    await act(() => {
      pointer(overlay()!, "pointerdown", 1);
      pointer(overlay()!, "pointerup", 2);
    });
    expect(overlay()).not.toBeNull();
    await act(() => {
      pointer(overlay()!, "pointerdown");
      pointer(overlay()!, "pointerup");
    });
    expect(overlay()).toBeNull();
    await act(expand);
    await act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(overlay()).toBeNull();
  });

  it("offers every presentation the field rules accept", () => {
    const page = mount(
      <FormResponseStats fields={[field({ fieldType: "select", options: null })]} stats={stats} total={4} />,
    );

    const picker = page.querySelector<HTMLSelectElement>('select[aria-label="Presentation for Priority"]')!;
    expect([...picker.options].map((option) => option.value)).toEqual([...VISUALIZATIONS]);
    // "Auto" still names the presentation it resolved to, so the reader can see
    // what an override would replace.
    expect(picker.options[0].textContent).toBe("Auto (Pie)");
  });

  it("gives every bar its own value in words, not only its length", async () => {
    const page = mount(<FormResponseStats fields={[field()]} stats={stats} total={4} />);

    // A select-with-two-options renders as a pie by default, so ask for bars.
    const picker = page.querySelector<HTMLSelectElement>("select")!;
    picker.value = "bar";
    await act(() => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const bars = [...page.querySelectorAll("[role=meter]")];
    expect(bars).toHaveLength(2);
    expect(bars.map((bar) => bar.getAttribute("aria-label"))).toEqual(["High: 75%", "Low: 25%"]);
    expect(page.querySelector(".pk-chart__bars")?.textContent).toContain("75% 3");
  });

  it("distinguishes no responses from responses that cannot be summarized", () => {
    const none = mount(<FormResponseStats fields={[field()]} stats={[]} total={0} />);
    expect(none.querySelector('[role="status"]')?.textContent).toContain("No responses yet.");

    const unsummarizable = mount(<FormResponseStats fields={[field()]} stats={[]} total={7} />);
    expect(unsummarizable.querySelector('[role="status"]')?.textContent).toContain("No answer statistics available.");
  });

  it("drops a statistic whose field the definition no longer lists", () => {
    const page = mount(
      <FormResponseStats
        fields={[field()]}
        stats={[...stats, { fieldKey: "removed_field", totalAnswers: 1, uniqueAnswers: 1, entries: [] }]}
        total={5}
      />,
    );
    expect(page.querySelectorAll("section")).toHaveLength(1);
    expect(page.textContent).not.toContain("removed_field");
  });
});
