import { stringify } from "yaml";
import type { ContentCall } from "../functions/_lib/services/site-shortcodes";
import type { ReadableModel } from "./model-version-source";

type ModelLevel = ReadableModel["levels"][number];
type ModelPart = "level" | "criteria" | "methodology" | "questions" | "evidence" | "section";
type Placement = ModelLevel["sections"][number]["placement"];

const PARTS = new Set<ModelPart>(["level", "criteria", "methodology", "questions", "evidence", "section"]);

/** A criterion's position within its level; questions and evidence keep their full identifier. */
function position(id: string) {
  return id.split(".").at(-1)!;
}

function shortcode(name: string, data: unknown) {
  return `{{< ${name} >}}\n${stringify(data).trim()}\n{{< /${name} >}}`;
}

/** Authored Markdown for the shared `item-table` component; identifiers become row permalinks. */
function itemTable(columns: string[], items: Array<{ id: string; cells: string[] }>) {
  return items.length ? shortcode("item-table", { columns, items }) : "";
}

function questionGroupMarkdown(group: ModelLevel["assessment"]["groups"][number], withHeading: boolean) {
  const intake = group.kind === "intake";
  const table = itemTable(
    intake ? ["Question", "Expected input", "Purpose"] : ["Question", "Assessment guidance"],
    group.questions.map((question) => ({
      id: question.id,
      cells: intake
        ? [question.question, question.expectedInput ?? "", question.purpose ?? ""]
        : [question.question, question.guidance],
    })),
  );
  return [withHeading ? `### ${group.name}` : "", group.introduction ?? "", table].filter(Boolean).join("\n\n");
}

/** "Assessed by Algorithm Availability 1.2.1, 1.2.2 and 1.2.4" with each identifier linking to its question. */
function assessedBy(level: ModelLevel, ids: string[]) {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const group = level.assessment.groups.find((entry) => entry.questions.some((question) => question.id === id));
    const name = group?.name ?? "Question";
    groups.set(name, [...(groups.get(name) ?? []), `[${id}](#${id})`]);
  }
  const list = (links: string[]) =>
    links.length > 1 ? `${links.slice(0, -1).join(", ")} and ${links.at(-1)}` : (links[0] ?? "");
  return `Assessed by ${[...groups].map(([name, links]) => `${name} ${list(links)}`).join("; ")}`;
}

function criteriaMarkdown(model: ReadableModel, level: ModelLevel) {
  const earlier = model.levels.filter((entry) => entry.number > 0 && entry.number < level.number);
  return shortcode("requirements", {
    marker: String(level.number),
    label: `Level ${level.number} · ${level.name}`,
    introduction: level.criteria.introduction,
    ...(earlier.length
      ? {
          includes: {
            label: "Includes every requirement of",
            links: earlier.map((entry) => ({
              label: `Level ${entry.number} · ${entry.name}`,
              href: `${entry.sourcePage}#criteria`,
            })),
          },
        }
      : {}),
    item: "Criterion",
    items: level.criteria.items.map((item) => ({
      id: item.id,
      label: position(item.id),
      text: item.text,
      ...(item.assessmentQuestionIds?.length ? { note: assessedBy(level, item.assessmentQuestionIds) } : {}),
    })),
  });
}

/**
 * Normative level content placed by `{{< model part="…" >}}` in the page's authored Markdown.
 * Guidance stays authored; every criterion, question group, evidence item and model section must be
 * placed exactly once, so content can no longer disappear silently from a published level page.
 * `{{< model part="level" >}}` lays out the whole level, placing sections by their `placement`, so the
 * model is the only source of level content. Individual parts and `{{< model-section >}}` (by title)
 * remain for pages that need a custom layout.
 */
export function createModelLevelContent(model: ReadableModel, level: ModelLevel) {
  const placed = new Set<string>();
  const place = (key: string) => {
    if (placed.has(key)) throw new Error(`Model content ${key} is placed more than once on ${level.sourcePage}`);
    placed.add(key);
  };

  /** Sections at a placement, headed by their own titles; a model can add or rename them freely. */
  function sectionsAt(placement: Placement, depth: 2 | 3) {
    return level.sections
      .filter((section) => section.placement === placement)
      .map((section) => {
        place(`section "${section.title}"`);
        return `${"#".repeat(depth)} ${section.title}\n\n${section.body}`;
      });
  }

  /** The whole level in the standard layout, so the page needs no content of its own. */
  function levelMarkdown(): string {
    const call = (part: ModelPart): ContentCall => ({ props: { part }, positional: [] });
    const groups = level.assessment.groups;
    const intakeOnly = groups.length > 0 && groups.every((group) => group.kind === "intake");
    const hasEvidence = level.evidenceChecklist.items.length > 0 || Boolean(level.evidenceChecklist.introduction);
    return [
      ...sectionsAt("before-criteria", 2),
      "## Criteria",
      render(call("criteria")),
      ...sectionsAt("after-criteria", 3),
      ...(groups.length || level.assessment.methodology
        ? [
            intakeOnly ? "## Supplier Intake Questions" : "## Assessment Questions",
            ...sectionsAt("before-assessment", 3),
            render(call("methodology")),
            render(call("questions")),
            ...sectionsAt("after-assessment", 3),
          ]
        : []),
      ...(hasEvidence ? ["## Evidence Checklist", render(call("evidence"))] : []),
      ...sectionsAt("after-evidence-checklist", 2),
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  function render(call: ContentCall): string {
    const part = (call.props.part ?? call.positional[0]) as ModelPart;
    if (!PARTS.has(part)) throw new Error(`Unknown model part "${String(part)}" on ${level.sourcePage}`);
    if (part === "level") return levelMarkdown();
    if (part === "section") {
      const title = call.props.title;
      if (!title) throw new Error(`A model section needs a title on ${level.sourcePage}`);
      const section = level.sections.find((entry) => entry.title === title);
      if (!section) {
        const fallback = call.inner?.trim();
        if (fallback || call.props.optional === "true") return fallback ?? "";
        throw new Error(
          `The model for ${level.sourcePage} has no section "${title}"; add it or mark the placement optional`,
        );
      }
      place(`section "${title}"`);
      return section.body;
    }
    if (part === "criteria") {
      place("criteria");
      return criteriaMarkdown(model, level);
    }
    if (part === "methodology") {
      place("methodology");
      return level.assessment.methodology ? `### Assessment methodology record\n\n${level.assessment.methodology}` : "";
    }
    if (part === "questions") {
      const groupId = call.props.group;
      const groups = groupId
        ? level.assessment.groups.filter((group) => group.id === groupId)
        : level.assessment.groups.filter((group) => !placed.has(`question group ${group.id ?? group.name}`));
      if (groupId && !groups.length) throw new Error(`Unknown question group ${groupId} on ${level.sourcePage}`);
      for (const group of groups) place(`question group ${group.id ?? group.name}`);
      return groups.map((group) => questionGroupMarkdown(group, !groupId)).join("\n\n");
    }
    place("evidence");
    const table = itemTable(
      ["Evidence"],
      level.evidenceChecklist.items.map((item) => ({ id: item.id, cells: [item.text] })),
    );
    return [level.evidenceChecklist.introduction, table].filter(Boolean).join("\n\n");
  }

  /** Model content the page did not place; publication fails rather than dropping it. */
  function unplaced(): string[] {
    const expected = [
      "criteria",
      ...(level.assessment.methodology ? ["methodology"] : []),
      ...level.assessment.groups.map((group) => `question group ${group.id ?? group.name}`),
      ...(level.evidenceChecklist.items.length || level.evidenceChecklist.introduction ? ["evidence"] : []),
      ...level.sections.map((section) => `section "${section.title}"`),
    ];
    return expected.filter((key) => !placed.has(key));
  }

  return { render, unplaced };
}
