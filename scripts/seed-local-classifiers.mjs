/**
 * Seeds neutral sample questions for the automatic checks in the LOCAL D1, so a
 * developer can try a check. The questions carry no policy: the real ones are
 * written by staff in the portal and never ship with the code.
 *
 * Local only, through `wrangler d1 execute --local`. Existing saved settings
 * are left alone, so running it twice changes nothing.
 *
 * Usage:
 *   node scripts/seed-local-classifiers.mjs [--persist-to <directory>]
 */

import { execFileSync } from "node:child_process";

const persistAt = process.argv.indexOf("--persist-to");
const persistArgs = persistAt === -1 ? [] : ["--persist-to", process.argv[persistAt + 1]];

const SAMPLE_QUESTIONS = [
  {
    id: "sample_spam",
    kind: "flag",
    question: "Is this text spam?",
    adviseAtPercent: 70,
    blockAtPercent: 95,
    message: "This looks like spam.",
  },
  {
    id: "sample_clarity",
    kind: "score",
    label: "Clarity",
    question: "How clear is this text?",
    levels: ["Unclear", "Somewhat unclear", "Fair", "Clear", "Very clear"],
    weight: 1,
  },
];

const KINDS = [
  { kind: "chat_message", model: "clef", questions: SAMPLE_QUESTIONS.slice(0, 1) },
  { kind: "audience_question", model: "clef", questions: SAMPLE_QUESTIONS.slice(0, 1) },
  { kind: "proposal", model: "clef", questions: SAMPLE_QUESTIONS },
  { kind: "presentation", model: "clef", questions: SAMPLE_QUESTIONS.slice(0, 1) },
  { kind: "organization_profile", model: "clef", questions: SAMPLE_QUESTIONS.slice(0, 1) },
  { kind: "person_profile", model: "clef", questions: SAMPLE_QUESTIONS.slice(0, 1) },
];

const escape = (value) => `'${String(value).replaceAll("'", "''")}'`;

const sql = KINDS.map(
  ({ kind, model, questions }) =>
    `INSERT OR IGNORE INTO classifier_settings (kind, enabled, model, context, questions_json, revision, updated_at)
     VALUES (${escape(kind)}, 1, ${escape(model)}, '', ${escape(JSON.stringify(questions))}, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'));`,
).join("\n");

execFileSync(
  "pnpm",
  ["exec", "wrangler", "d1", "execute", "DB", "--env", "local", "--local", ...persistArgs, "--command", sql],
  { stdio: "inherit" },
);
console.log("[seed-classifiers] sample questions saved where none were.");
