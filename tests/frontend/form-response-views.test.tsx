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

import type { FormSubmission } from "../../assets/shared/schemas/form-management";
import type { FormFieldDefinition } from "../../assets/shared/schemas/forms";
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
    const page = mount(
      <FormSubmissionsTable
        fields={[field()]}
        endpoint="/api/v1/forms/f/submissions"
        responseSchema={submissionsSchema}
      />,
    );
    await settle();

    // The table names itself among the tables on the page.
    expect(page.querySelector("caption")?.textContent).toBe("Form responses");

    const view = [...page.querySelectorAll("button")].find((button) => button.textContent === "View")!;
    expect(view.getAttribute("aria-label")).toBe("View answers from Ada Lovelace");
    expect(view.getAttribute("aria-expanded")).toBe("false");

    await act(() => view.click());
    await settle();
    const expanded = [...page.querySelectorAll("button")].find((button) => button.textContent === "Hide")!;
    expect(expanded.getAttribute("aria-expanded")).toBe("true");
    expect(expanded.getAttribute("aria-label")).toBe("Hide answers from Ada Lovelace");
    expect(page.querySelector("dl")).toBeTruthy();
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
      />,
    );
    await settle();

    expect(page.textContent).not.toContain("No responses found");
    // The error is announced, not merely coloured.
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

  it("gives every bar its own value in words, not only its length", async () => {
    const page = mount(<FormResponseStats fields={[field()]} stats={stats} total={4} />);

    // A select-with-two-options renders as a pie by default, so ask for bars.
    const picker = page.querySelector<HTMLSelectElement>("select")!;
    picker.value = "bar";
    await act(() => {
      picker.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const bars = [...page.querySelectorAll("progress")];
    expect(bars).toHaveLength(2);
    expect(bars.map((bar) => bar.getAttribute("aria-label"))).toEqual(["High: 75%", "Low: 25%"]);
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
