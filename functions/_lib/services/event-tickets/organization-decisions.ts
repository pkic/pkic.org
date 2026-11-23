/**
 * The ticket each organization gets, as organizers see and steer it: the
 * decisions that count for an event's tickets, a test of the classifier that
 * stores nothing, an organizer's own decision, and clearing a decision so the
 * classifier asks again at the next registration.
 *
 * Decisions are shared: another event that offers the same ticket finds the
 * same decision, so a change here applies there too.
 */
import {
  eventTicketOrganizationListSchema,
  type EventTicketOrganizationDecision,
  type EventTicketOrganizationListQuery,
  type EventTicketOrganizationTrial,
  type EventTicketOrganizationTrialResponse,
} from "../../../../assets/shared/schemas/event-ticket-organizations";
import { decideClassifiedTicket } from "../../../../assets/shared/event-tickets";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { workEmailDomain } from "../../email-domains/classification";
import { AppError } from "../../errors";
import { sha256Hex } from "../../utils/crypto";
import type { DatabaseLike, Env, UserBackedAuthAdmin } from "../../types";
import { prepareAuditLog } from "../audit";
import {
  askTicketClassifier,
  classifierOptions,
  decisionsInScope,
  prepareStoreTicketDecision,
  readStoredTicketDecision,
  subjectKey,
  type TicketClassifierSubject,
} from "./classifier";
import { readEventTicketSnapshot } from "./snapshot";

type TicketEvent = { id: string; timezone: string };

interface DecisionRow {
  id: string;
  organization_name: string;
  email_domain: string;
  ticket_key: string;
  source: string;
  confidence: number | null;
  updated_at: string;
}

function percent(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 1) * 100);
}

/** How sure the classifier was; an organizer's decision has no certainty. */
function certainty(source: string, confidence: number | null): number | null {
  return source === "organizer" || confidence === null ? null : percent(confidence);
}

/** The organization as registration keys it: a personal mail domain counts as none. */
function subjectOf(input: { organizationName: string; emailDomain?: string | undefined }): TicketClassifierSubject {
  const domain = input.emailDomain?.trim();
  return { organizationName: input.organizationName, emailDomain: domain ? workEmailDomain(domain) : null };
}

async function readTypes(db: DatabaseLike, event: TicketEvent) {
  return (await readEventTicketSnapshot(db, event)).types;
}

/** One row per organization: the decision that counts for it, as registration finds it. */
export async function listTicketOrganizations(
  db: DatabaseLike,
  event: TicketEvent,
  query: EventTicketOrganizationListQuery,
) {
  const scope = decisionsInScope(await readTypes(db, event));
  const search = query.q ? buildD1TextSearchFilter(query.q, ["organization_name", "email_domain"]) : null;
  const decidedBy =
    query.decidedBy === "organizer"
      ? " AND source = 'organizer'"
      : query.decidedBy === "classifier"
        ? " AND source <> 'organizer'"
        : "";
  const { rows, total } = await queryPage<DecisionRow>(db, {
    source: {
      withSql: `WITH counted AS (
        SELECT id, organization_name, email_domain, ticket_key, source, confidence, updated_at,
          ROW_NUMBER() OVER (PARTITION BY organization_name, email_domain ORDER BY ${scope.precedence}) AS rank
        FROM ticket_classifier_decisions WHERE ${scope.where})`,
      selectSql: "SELECT id, organization_name, email_domain, ticket_key, source, confidence, updated_at",
      fromSql: `FROM counted WHERE rank = 1${decidedBy}${search ? ` AND (${search.sql})` : ""}`,
      bindings: [...scope.bindings, ...(search?.bindings ?? [])],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { organization: "organization_name", updated: "updated_at" },
      "updated_at DESC",
      "id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return eventTicketOrganizationListSchema.parse({
    organizations: rows.map((row) => ({
      id: row.id,
      organizationName: row.organization_name,
      emailDomain: row.email_domain,
      ticketKey: row.ticket_key,
      decidedBy: row.source === "organizer" ? "organizer" : "classifier",
      confidencePercent: certainty(row.source, row.confidence),
      updatedAt: row.updated_at,
    })),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}

/** Asks the classifier as registration would, and stores nothing. */
export async function testTicketOrganization(
  db: DatabaseLike,
  env: Pick<Env, "AI" | "TICKET_CLASSIFIER_MODEL">,
  event: TicketEvent,
  input: EventTicketOrganizationTrial,
): Promise<EventTicketOrganizationTrialResponse> {
  const types = await readTypes(db, event);
  const options = classifierOptions(types);
  if (options.length < 2)
    throw new AppError(
      409,
      "TICKET_CLASSIFIER_OFF",
      "Describe who qualifies for at least two tickets before testing the classifier.",
    );
  const subject = subjectOf(input);
  const [asked, current] = await Promise.all([
    askTicketClassifier(env, options, subject),
    readStoredTicketDecision(db, types, subject),
  ]);
  if (!asked) throw new AppError(503, "TICKET_CLASSIFIER_UNAVAILABLE", "The classifier did not answer. Try again.");
  const decided = decideClassifiedTicket(options, asked.probabilities);
  const answers = options
    .map((option) => ({
      ticketKey: option.key,
      percent: percent(asked.probabilities[option.key] ?? 0),
      thresholdPercent: percent(option.threshold),
    }))
    .sort((a, b) => b.percent - a.percent);
  return {
    emailDomain: subject.emailDomain,
    answers,
    decidedTicketKey: decided?.key ?? null,
    current: current
      ? {
          ticketKey: current.ticketKey,
          decidedBy: current.source,
          confidencePercent: certainty(current.source, current.confidence),
        }
      : null,
  };
}

/** An organizer's decision, which the classifier never replaces. */
export async function decideTicketOrganization(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: TicketEvent,
  input: EventTicketOrganizationDecision,
): Promise<void> {
  const types = await readTypes(db, event);
  if (!types.some((type) => type.active === 1 && type.ticket_key === input.ticketKey))
    throw new AppError(409, "TICKET_NOT_OFFERED", "This event does not offer that ticket. Reload and choose another.");
  const subject = subjectOf(input);
  const key = subjectKey(subject);
  const offered = types.filter((type) => type.active === 1).map((type) => type.ticket_key);
  // Keyed on the tickets on offer, so events with other tickets keep their own decision.
  const criteriaDigest = await sha256Hex(`organizer:${[...offered].sort().join("\n")}`);
  await db.batch([
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: event.id } },
    ]),
    // An earlier organizer's decision that counts here would otherwise stay beside the new one.
    db
      .prepare(
        `DELETE FROM ticket_classifier_decisions
          WHERE source = 'organizer' AND organization_name = ? AND email_domain = ? AND criteria_sha256 <> ?
            AND ticket_key IN (${offered.map(() => "?").join(", ")})`,
      )
      .bind(key.organizationName, key.emailDomain, criteriaDigest, ...offered),
    prepareStoreTicketDecision(db, {
      criteriaDigest,
      subject,
      ticketKey: input.ticketKey,
      source: "organizer",
      confidence: null,
      model: null,
      decidedByUserId: actor.id,
    }),
    prepareAuditLog(db, "user", actor.id, "ticket_organization_decided", "event", event.id, {
      organizationName: key.organizationName,
      emailDomain: key.emailDomain,
      ticketKey: input.ticketKey,
    }),
  ]);
}

/** Clears every decision that counts for the organization, so the next registration asks the classifier again. */
export async function clearTicketOrganizationDecision(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: TicketEvent,
  decisionId: string,
): Promise<void> {
  const scope = decisionsInScope(await readTypes(db, event));
  const row = await first<{ organization_name: string; email_domain: string }>(
    db,
    `SELECT organization_name, email_domain FROM ticket_classifier_decisions WHERE id = ? AND ${scope.where}`,
    [decisionId, ...scope.bindings],
  );
  if (!row) throw new AppError(404, "TICKET_DECISION_NOT_FOUND", "This event has no such decision. Reload the list.");
  await db.batch([
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: event.id } },
    ]),
    db
      .prepare(
        `DELETE FROM ticket_classifier_decisions WHERE organization_name = ? AND email_domain = ? AND ${scope.where}`,
      )
      .bind(row.organization_name, row.email_domain, ...scope.bindings),
    prepareAuditLog(db, "user", actor.id, "ticket_organization_decision_cleared", "event", event.id, {
      organizationName: row.organization_name,
      emailDomain: row.email_domain,
    }),
  ]);
}
