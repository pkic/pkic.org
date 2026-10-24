import type { ReadableModel } from "./model-version-source";

export function modelLevelSlug(level: ReadableModel["levels"][number]) {
  return level.sourcePage.split("/").filter(Boolean).at(-1)!;
}

export function modelVersionMarkdown(model: ReadableModel, root: string, levelNumber?: number): string {
  const links = model.levels.map((l) => `[${l.number} — ${l.name}](${root}levels/${modelLevelSlug(l)}/)`).join(" · ");
  const level = model.levels.find((l) => l.number === levelNumber);
  if (!level)
    return `${model.model.description}\n\n## How levels are established\n\n${model.scoring.rule}\n\n## Maturity levels\n\n${model.levels.map((l) => `### [${l.number} — ${l.name}](${root}levels/${modelLevelSlug(l)}/)\n\n${l.summary}`).join("\n\n")}`;
  const sections = (placement: string) =>
    level.sections
      .filter((s) => (s.placement ?? "after-criteria") === placement)
      .map((s) => `### ${s.title}\n\n${s.body}`)
      .join("\n\n");
  return [
    `[Model overview](${root}) · ${links}`,
    level.summary,
    "## Criteria",
    level.criteria.introduction,
    ...level.criteria.items.map((c) => `### Criterion ${c.id}\n\n${c.text}`),
    sections("after-criteria"),
    "## Assessment questions",
    level.assessment.methodology,
    ...level.assessment.groups.flatMap((g) => [
      `### ${g.name}`,
      ...g.questions.map((q) => `#### Question ${q.id}\n\n${q.question}\n\n${q.guidance}`),
    ]),
    sections("after-assessment"),
    "## Evidence checklist",
    level.evidenceChecklist.introduction,
    ...level.evidenceChecklist.items.map((e) => `### Evidence ${e.id}\n\n${e.text}`),
    sections("after-evidence-checklist"),
  ]
    .filter(Boolean)
    .join("\n\n")
    .replaceAll("/wg/pqc/pqcmm/levels/", `${root}levels/`)
    .replace(/\n\{\.callout-(?:info|warning)\}/g, "");
}
