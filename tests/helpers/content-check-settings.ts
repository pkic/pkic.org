import { env } from "cloudflare:workers";
import type { ContentCheckKind, ContentCheckQuestion } from "../../assets/shared/content-checks";

/** A flag that advises from 60% and, unless told otherwise, blocks from 90%. */
export function sampleFlag(id: string, message: string, blockAtPercent: number | null = 90): ContentCheckQuestion {
  return { id, kind: "flag", question: `Does this raise ${id}?`, adviseAtPercent: 60, blockAtPercent, message };
}

export function sampleScore(id: string): ContentCheckQuestion {
  return {
    id,
    kind: "score",
    label: id,
    question: `How would you rate ${id}?`,
    levels: ["Lowest", "Low", "Middle", "High", "Highest"],
    weight: 1,
  };
}

/** Saves PKIC-wide settings for one kind, as staff would: nothing is checked until this runs. */
export async function saveCheckSettings(
  kind: ContentCheckKind,
  questions: ContentCheckQuestion[],
  { context = "", model = "clef", enabled = true }: { context?: string; model?: string; enabled?: boolean } = {},
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO content_check_settings (kind, enabled, model, context, questions_json, revision, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(kind, enabled ? 1 : 0, model, context, JSON.stringify(questions), new Date().toISOString())
    .run();
}
