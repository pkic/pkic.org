import { stringify } from "yaml";
import type { ContentCall } from "../functions/_lib/services/site-shortcodes";
import type { ReadableModel } from "./model-version-source";

type ModelLevel = ReadableModel["levels"][number];
type ModelPart = "criteria" | "methodology" | "questions" | "evidence" | "section";

const PARTS = new Set<ModelPart>(["criteria", "methodology", "questions", "evidence", "section"]);

/** Authored Markdown for the shared `item-table` component; identifiers become row permalinks. */
function itemTable(columns: string[], items: Array<{ id: string; cells: string[] }>) {
  return items.length ? `{{< item-table >}}\n${stringify({ columns, items }).trim()}\n{{< /item-table >}}` : "";
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

/**
 * Normative level content placed by `{{< model part="…" >}}` in the page's authored Markdown.
 * Guidance stays authored; every criterion, question group, evidence item and model section must be
 * placed exactly once, so content can no longer disappear silently from a published level page.
 * Model sections are placed by title with `{{< model-section >}}`; its inner Markdown is the fallback
 * for model versions that do not carry that section yet.
 */
export function createModelLevelContent(level: ModelLevel) {
  const placed = new Set<string>();
  const place = (key: string) => {
    if (placed.has(key)) throw new Error(`Model content ${key} is placed more than once on ${level.sourcePage}`);
    placed.add(key);
  };

  function render(call: ContentCall): string {
    const part = (call.props.part ?? call.positional[0]) as ModelPart;
    if (!PARTS.has(part)) throw new Error(`Unknown model part "${String(part)}" on ${level.sourcePage}`);
    if (part === "section") {
      const title = call.props.title;
      const section = level.sections.find((entry) => entry.title === title);
      if (!title) throw new Error(`A model section needs a title on ${level.sourcePage}`);
      if (!section) return call.inner?.trim() ?? "";
      place(`section "${title}"`);
      return section.body;
    }
    if (part === "criteria") {
      place("criteria");
      const assessedBy = level.criteria.items.some((item) => item.assessmentQuestionIds?.length);
      const table = itemTable(
        assessedBy ? ["Criterion", "Assessed by"] : ["Criterion"],
        level.criteria.items.map((item) => ({
          id: item.id,
          cells: assessedBy
            ? [item.text, (item.assessmentQuestionIds ?? []).map((id) => `[${id}](#${id})`).join(", ")]
            : [item.text],
        })),
      );
      return `{{< criteria >}}\n${[level.criteria.introduction, table].filter(Boolean).join("\n\n")}\n{{< /criteria >}}`;
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
