/**
 * The ticket classifier: which of an event's tickets fits an organization.
 *
 * The question is generic. Each ticket that takes part carries its own "who
 * qualifies" description, and the classifier picks between them, so a new
 * kind of ticket needs a description and no code. The model behind it is one
 * configuration value; nothing else in the application names it.
 *
 * A decision is made once for an organization name and email domain and
 * stored against the canonical form of the question. Another event that asks
 * the same question reuses it. An organizer's decision is never replaced.
 */
import {
  decideClassifiedTicket,
  normalizeTicketOrganizationName,
  ticketClassifierCriteria,
  type TicketClassifierOption,
} from "../../../../assets/shared/event-tickets";
import { first } from "../../db/queries";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { logError } from "../../logging";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import type { TicketTypeRow } from "./snapshot";

/** The decision model in use unless `TICKET_CLASSIFIER_MODEL` names another. */
const DEFAULT_CLASSIFIER_MODEL = "@cf/cloudflare/clef";
const CLASSIFIER_TIMEOUT_MS = 4000;

export interface TicketClassifierSubject {
  organizationName: string | null;
  emailDomain: string | null;
}

export interface StoredTicketDecision {
  ticketKey: string;
  source: "classifier" | "organizer";
  confidence: number | null;
}

/** The tickets the classifier chooses between: active, with a description of who qualifies. */
export function classifierOptions(types: readonly TicketTypeRow[]): TicketClassifierOption[] {
  return types
    .filter((type) => type.active === 1 && type.classifier_description?.trim())
    .map((type) => ({
      key: type.ticket_key,
      description: type.classifier_description!.trim(),
      threshold: type.classifier_threshold,
    }));
}

export async function ticketCriteriaDigest(options: readonly TicketClassifierOption[]): Promise<string> {
  const bytes = new TextEncoder().encode(ticketClassifierCriteria(options));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function subjectKey(subject: TicketClassifierSubject) {
  return {
    organizationName: normalizeTicketOrganizationName(subject.organizationName),
    emailDomain: (subject.emailDomain ?? "").trim().toLowerCase(),
  };
}

export async function readStoredTicketDecision(
  db: DatabaseLike,
  criteriaDigest: string,
  subject: TicketClassifierSubject,
): Promise<StoredTicketDecision | null> {
  const key = subjectKey(subject);
  if (!key.organizationName && !key.emailDomain) return null;
  const row = await first<{ ticket_key: string; source: string; confidence: number | null }>(
    db,
    `SELECT ticket_key, source, confidence FROM ticket_classifier_decisions
     WHERE criteria_sha256 = ? AND organization_name = ? AND email_domain = ?`,
    [criteriaDigest, key.organizationName, key.emailDomain],
  );
  return row
    ? {
        ticketKey: row.ticket_key,
        source: row.source === "organizer" ? "organizer" : "classifier",
        confidence: row.confidence,
      }
    : null;
}

/** Stores a decision. A classifier's answer never replaces an organizer's. */
export function prepareStoreTicketDecision(
  db: DatabaseLike,
  input: {
    criteriaDigest: string;
    subject: TicketClassifierSubject;
    ticketKey: string;
    source: "classifier" | "organizer";
    confidence: number | null;
    model: string | null;
    decidedByUserId?: string | null;
  },
): StatementLike {
  const key = subjectKey(input.subject);
  const now = nowIso();
  return db
    .prepare(
      `INSERT INTO ticket_classifier_decisions
         (id, organization_name, email_domain, criteria_sha256, ticket_key, confidence, source, model,
          decided_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(criteria_sha256, organization_name, email_domain) DO UPDATE SET
         ticket_key = excluded.ticket_key, confidence = excluded.confidence, source = excluded.source,
         model = excluded.model, decided_by_user_id = excluded.decided_by_user_id, updated_at = excluded.updated_at
       WHERE excluded.source = 'organizer' OR ticket_classifier_decisions.source <> 'organizer'`,
    )
    .bind(
      uuid(),
      key.organizationName,
      key.emailDomain,
      input.criteriaDigest,
      input.ticketKey,
      input.confidence,
      input.source,
      input.model,
      input.decidedByUserId ?? null,
      now,
      now,
    );
}

interface ClassifierAnswer {
  answers?: { ticket?: { probabilities?: Record<string, unknown> } };
}

/**
 * Asks the model once. Returns the option probabilities, or null when the
 * model is not configured, fails, is slow, or answers in another shape: the
 * caller then carries on with the default ticket.
 */
export async function askTicketClassifier(
  env: Pick<Env, "AI" | "TICKET_CLASSIFIER_MODEL">,
  options: readonly TicketClassifierOption[],
  subject: TicketClassifierSubject,
): Promise<{ probabilities: Record<string, number>; model: string } | null> {
  if (!env.AI || options.length < 2) return null;
  const model = env.TICKET_CLASSIFIER_MODEL?.trim() || DEFAULT_CLASSIFIER_MODEL;
  try {
    const answer = (await Promise.race([
      env.AI.run(model, {
        model: model.split("/").pop(),
        state: {
          organization: subject.organizationName ?? "",
          email_domain: subject.emailDomain ?? "",
        },
        questions: {
          ticket: {
            type: "choice",
            instructions:
              "Which description fits this organization best? Judge the organization as a whole, not one person's role.",
            criteria: Object.fromEntries(options.map((option) => [option.key, option.description])),
          },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TICKET_CLASSIFIER_TIMEOUT")), CLASSIFIER_TIMEOUT_MS),
      ),
    ])) as ClassifierAnswer;
    const raw = answer?.answers?.ticket?.probabilities;
    if (!raw || typeof raw !== "object") return null;
    const probabilities: Record<string, number> = {};
    for (const option of options) {
      const value = raw[option.key];
      if (typeof value === "number" && Number.isFinite(value)) probabilities[option.key] = value;
    }
    return Object.keys(probabilities).length ? { probabilities, model } : null;
  } catch (error) {
    // The subject is an organization name; keep it out of logs with the rest of the request.
    logError("TICKET_CLASSIFIER_FAILED", { reason: error instanceof Error ? error.message.slice(0, 120) : "unknown" });
    return null;
  }
}

/**
 * The ticket decided for an organization: the stored decision when there is
 * one, otherwise a fresh answer that is stored when it is certain enough.
 * Null means nothing decides, and the person chooses or gets the default.
 */
export async function decideOrganizationTicket(
  db: DatabaseLike,
  env: Pick<Env, "AI" | "TICKET_CLASSIFIER_MODEL">,
  types: readonly TicketTypeRow[],
  subject: TicketClassifierSubject,
): Promise<StoredTicketDecision | null> {
  const options = classifierOptions(types);
  if (options.length < 2) return null;
  const key = subjectKey(subject);
  if (!key.organizationName && !key.emailDomain) return null;
  const digest = await ticketCriteriaDigest(options);
  const stored = await readStoredTicketDecision(db, digest, subject);
  if (stored && storedDecisionHolds(types, options, stored)) return stored;
  const asked = await askTicketClassifier(env, options, subject);
  if (!asked) return null;
  const decided = decideClassifiedTicket(options, asked.probabilities);
  if (!decided) return null;
  await db.batch([
    prepareStoreTicketDecision(db, {
      criteriaDigest: digest,
      subject,
      ticketKey: decided.key,
      source: "classifier",
      confidence: decided.confidence,
      model: asked.model,
    }),
  ]);
  // An organizer may have decided while the answer was pending; their decision survived the write and is the one that counts.
  return (
    (await readStoredTicketDecision(db, digest, subject)) ?? {
      ticketKey: decided.key,
      source: "classifier",
      confidence: decided.confidence,
    }
  );
}

/**
 * A stored answer still decides when its ticket is offered. An organizer may decide for any offered ticket,
 * also one the classifier never picks; the classifier's own answer must be one of its options and certain enough today.
 */
function storedDecisionHolds(
  types: readonly TicketTypeRow[],
  options: readonly TicketClassifierOption[],
  stored: StoredTicketDecision,
): boolean {
  if (stored.source !== "classifier")
    return types.some((type) => type.ticket_key === stored.ticketKey && type.active === 1);
  if (!options.some((option) => option.key === stored.ticketKey)) return false;
  return decideClassifiedTicket(options, { [stored.ticketKey]: stored.confidence ?? 0 }) !== null;
}
