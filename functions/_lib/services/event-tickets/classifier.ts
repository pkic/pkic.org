/**
 * The ticket classifier: which of an event's tickets fits an organization.
 *
 * The question is generic. Each ticket that takes part carries its own "who
 * qualifies" description, and the classifier picks between them, so a new
 * kind of ticket needs a description and no code. The model behind it is one
 * configuration value; nothing else in the application names it.
 *
 * A decision is made once for a portal organization, from its name and every
 * domain it is recognized by, and found again by the ticket key it chose: one
 * key is one way of judging, such as who is a vendor for the conference.
 * Tuning a description, a threshold or the instructions keeps the decision,
 * and every later event that offers the same ticket key reuses it. An organizer's decision
 * is never replaced. A person who registers for no organization is asked
 * about by their work domain each time, and nothing is stored for them.
 */
import { decideClassifiedTicket, type TicketClassifierOption } from "../../../../assets/shared/event-tickets";
import { all, first } from "../../db/queries";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { logError } from "../../logging";
import { organizationConnectionDomainsSql } from "../organization-management/read-model";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import type { TicketTypeRow } from "./snapshot";

/** The decision model in use unless `TICKET_CLASSIFIER_MODEL` names another. */
const DEFAULT_CLASSIFIER_MODEL = "@cf/cloudflare/clef";
const CLASSIFIER_TIMEOUT_MS = 4000;

/** The most domains the model is given for one organization. */
const MAX_SUBJECT_DOMAINS = 10;

export interface TicketClassifierSubject {
  /** The portal organization the decision is stored for; null for a person registering for no organization. */
  organizationId: string | null;
  organizationName: string | null;
  /** The organization's recognized domains, or the person's own work domain when there is no organization. */
  domains: readonly string[];
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

/** Every domain a portal organization is recognized by: its claimed domains and its people's verified ones. */
export function organizationDomainsSql(organizationIdSql: string): string {
  return `(SELECT group_concat(domain, ' ') FROM (SELECT DISTINCT LOWER(known.domain) AS domain
      FROM (${organizationConnectionDomainsSql(organizationIdSql)}) known ORDER BY 1 LIMIT ${String(MAX_SUBJECT_DOMAINS)}))`;
}

export function splitDomains(domains: string | null): string[] {
  return domains ? domains.split(" ").filter(Boolean) : [];
}

/** The portal organizations as the classifier is asked about them, in the order of the ids; missing ones are left out. */
export async function readOrganizationSubjects(
  db: DatabaseLike,
  organizationIds: readonly string[],
): Promise<Map<string, TicketClassifierSubject>> {
  if (!organizationIds.length) return new Map();
  const rows = await all<{ id: string; name: string; domains: string | null }>(
    db,
    `SELECT o.id, o.name, ${organizationDomainsSql("o.id")} AS domains
     FROM organizations o WHERE o.id IN (SELECT value FROM json_each(?)) AND o.merged_into_organization_id IS NULL`,
    [JSON.stringify(organizationIds)],
  );
  return new Map(
    rows.map((row) => [
      row.id,
      { organizationId: row.id, organizationName: row.name, domains: splitDomains(row.domains) },
    ]),
  );
}

/**
 * The decisions that count for these tickets: any for a ticket the event offers, whoever made it and whether or not
 * the ticket is still described. A decision made stays made. An organizer's comes first, the latest of them; then
 * the classifier's first answer, so a later answer for other tickets does not move the organization.
 */
export function decisionsInScope(types: readonly TicketTypeRow[]) {
  const offered = types.filter((type) => type.active === 1).map((type) => type.ticket_key);
  return {
    where: `ticket_key IN (${offered.length ? offered.map(() => "?").join(", ") : "NULL"})`,
    precedence:
      "CASE source WHEN 'organizer' THEN 0 ELSE 1 END, CASE source WHEN 'organizer' THEN updated_at END DESC, created_at, id",
    bindings: offered,
  };
}

export async function readStoredTicketDecision(
  db: DatabaseLike,
  types: readonly TicketTypeRow[],
  subject: TicketClassifierSubject,
): Promise<StoredTicketDecision | null> {
  if (!subject.organizationId) return null;
  const scope = decisionsInScope(types);
  const row = await first<{ ticket_key: string; source: string; confidence: number | null }>(
    db,
    `SELECT ticket_key, source, confidence FROM ticket_organization_decisions
     WHERE organization_id = ? AND ${scope.where}
     ORDER BY ${scope.precedence} LIMIT 1`,
    [subject.organizationId, ...scope.bindings],
  );
  return row
    ? {
        ticketKey: row.ticket_key,
        source: row.source === "organizer" ? "organizer" : "classifier",
        confidence: row.confidence,
      }
    : null;
}

/** How many organizations each ticket is decided for: the decision that counts for each, as the lookup finds it. */
export function prepareDecidedOrganizationCounts(db: DatabaseLike, types: readonly TicketTypeRow[]): StatementLike {
  const scope = decisionsInScope(types);
  return db
    .prepare(
      `SELECT ticket_key, COUNT(*) AS total FROM (
         SELECT ticket_key, ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY ${scope.precedence}) AS rank
         FROM ticket_organization_decisions WHERE ${scope.where}
       ) WHERE rank = 1 GROUP BY ticket_key`,
    )
    .bind(...scope.bindings);
}

/** Stores a decision. A classifier's answer never replaces an organizer's. */
export function prepareStoreTicketDecision(
  db: DatabaseLike,
  input: {
    organizationId: string;
    ticketKey: string;
    source: "classifier" | "organizer";
    confidence: number | null;
    model: string | null;
    decidedByUserId?: string | null;
  },
): StatementLike {
  const now = nowIso();
  return db
    .prepare(
      `INSERT INTO ticket_organization_decisions
         (id, organization_id, ticket_key, confidence, source, model, decided_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(organization_id, ticket_key) DO UPDATE SET
         confidence = excluded.confidence, source = excluded.source, model = excluded.model,
         decided_by_user_id = excluded.decided_by_user_id, updated_at = excluded.updated_at
       WHERE excluded.source = 'organizer' OR ticket_organization_decisions.source <> 'organizer'`,
    )
    .bind(
      uuid(),
      input.organizationId,
      input.ticketKey,
      input.confidence,
      input.source,
      input.model,
      input.decidedByUserId ?? null,
      now,
      now,
    );
}

/**
 * An organizer's decision for an organization among the tickets on offer. It replaces every decision that counted
 * for those tickets, so the organizer's choice is the only one left there.
 */
export function prepareOrganizerTicketDecision(
  db: DatabaseLike,
  types: readonly TicketTypeRow[],
  input: { organizationId: string; ticketKey: string; decidedByUserId: string },
): StatementLike[] {
  const scope = decisionsInScope(types);
  return [
    db
      .prepare(
        `DELETE FROM ticket_organization_decisions WHERE organization_id = ? AND ticket_key <> ? AND ${scope.where}`,
      )
      .bind(input.organizationId, input.ticketKey, ...scope.bindings),
    prepareStoreTicketDecision(db, { ...input, source: "organizer", confidence: null, model: null }),
  ];
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
          domains: subject.domains.join(", "),
        },
        questions: {
          ticket: {
            type: "choice",
            // Event-neutral: what makes an organization fit lives in each ticket's own description.
            instructions:
              "Use what you know about this organization: what it does and what it sells. Pick the description that fits it, following each description literally. Judge the organization as a whole, not one person's role.",
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
  // Nothing names an organization or a work domain: the model has nothing to judge.
  if (!subject.organizationName && !subject.domains.length) return null;
  const options = classifierOptions(types);
  // A stored decision applies with or without a classifier, as dispute review and the counts show it.
  const stored = await readStoredTicketDecision(db, types, subject);
  if (stored) return stored;
  if (options.length < 2) return null;
  const asked = await askTicketClassifier(env, options, subject);
  if (!asked) return null;
  const decided = decideClassifiedTicket(options, asked.probabilities);
  if (!decided) return null;
  const answer = { ticketKey: decided.key, source: "classifier" as const, confidence: decided.confidence };
  if (!subject.organizationId) return answer;
  await db.batch([
    prepareStoreTicketDecision(db, {
      organizationId: subject.organizationId,
      ticketKey: decided.key,
      source: "classifier",
      confidence: decided.confidence,
      model: asked.model,
    }),
  ]);
  // An organizer may have decided while the answer was pending; their decision survived the write and is the one that counts.
  return (await readStoredTicketDecision(db, types, subject)) ?? answer;
}
