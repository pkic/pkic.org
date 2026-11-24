/**
 * The ticket each organization gets, as organizers see and steer it: the
 * portal organizations with the decision that counts for an event's tickets,
 * a test of the classifier that stores nothing, organizers' own decisions,
 * and clearing a decision so the classifier asks again at the next
 * registration.
 *
 * A decision belongs to a portal organization and holds no copy of its name or
 * domains. Decisions are shared: another event that offers the same ticket
 * finds the same decision, so a change here applies there too.
 */
import {
  eventTicketOrganizationListSchema,
  type EventTicketClassifierDraft,
  type EventTicketOrganizationDecisions,
  type EventTicketOrganizationListQuery,
  type EventTicketOrganizationTrial,
  type EventTicketOrganizationTrialResponse,
  type EventTicketOrganizationTrialResult,
  type TicketOrganizationSubject,
} from "../../../../assets/shared/schemas/event-ticket-organizations";
import { decideClassifiedTicket } from "../../../../assets/shared/event-tickets";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isStateGuardFailure, prepareStateGuard } from "../../db/authorization-guard";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { workEmailDomain } from "../../email-domains/classification";
import { AppError } from "../../errors";
import type { DatabaseLike, Env, StatementLike, UserBackedAuthAdmin } from "../../types";
import { prepareAuditLog } from "../audit";
import { organizationConnectionDomainsSql } from "../organization-management/read-model";
import {
  askTicketClassifier,
  classifierOptions,
  decisionsInScope,
  organizationDomainsSql,
  prepareOrganizerTicketDecision,
  readOrganizationSubjects,
  readStoredTicketDecision,
  splitDomains,
  type TicketClassifierSubject,
} from "./classifier";
import { readEventTicketSnapshot, type TicketTypeRow } from "./snapshot";

type TicketEvent = { id: string; timezone: string };

interface OrganizationRow {
  id: string | null;
  organization_id: string;
  organization_name: string;
  domains: string | null;
  ticket_key: string | null;
  source: string | null;
  confidence: number | null;
  updated_at: string | null;
}

function percent(value: number): number {
  return Math.round(Math.min(Math.max(value, 0), 1) * 100);
}

/** How sure the classifier was; an organizer's decision has no certainty. */
function certainty(source: string, confidence: number | null): number | null {
  return source === "organizer" || confidence === null ? null : percent(confidence);
}

async function readTypes(db: DatabaseLike, event: TicketEvent) {
  return (await readEventTicketSnapshot(db, event)).types;
}

/**
 * One row per portal organization that is not merged away, with the decision that counts for it under these
 * tickets: only those with one, or every organization in the portal.
 */
export async function listTicketOrganizations(
  db: DatabaseLike,
  event: TicketEvent,
  query: EventTicketOrganizationListQuery,
) {
  const scope = decisionsInScope(await readTypes(db, event));
  const portal = query.among === "portal";
  const decided = [
    query.decidedBy === "organizer"
      ? "d.source = 'organizer'"
      : query.decidedBy === "classifier"
        ? "d.source <> 'organizer'"
        : "",
    query.ticketKey ? "d.ticket_key = ?" : "",
  ].filter(Boolean);
  const name = query.q ? buildD1TextSearchFilter(query.q, ["o.name"]) : null;
  const domain = query.q ? buildD1TextSearchFilter(query.q, ["known.domain"]) : null;
  const where = [
    "o.merged_into_organization_id IS NULL",
    ...decided,
    ...(name && domain
      ? [
          `(${name.sql} OR EXISTS (SELECT 1 FROM (${organizationConnectionDomainsSql("o.id")}) known WHERE ${domain.sql}))`,
        ]
      : []),
  ];
  const { rows, total } = await queryPage<OrganizationRow>(db, {
    source: {
      withSql: `WITH counted AS (
        SELECT id, organization_id, ticket_key, source, confidence, updated_at,
          ROW_NUMBER() OVER (PARTITION BY organization_id ORDER BY ${scope.precedence}) AS rank
        FROM ticket_organization_decisions WHERE ${scope.where})`,
      selectSql: `SELECT d.id AS id, o.id AS organization_id, o.name AS organization_name,
        ${organizationDomainsSql("o.id", null)} AS domains,
        d.ticket_key AS ticket_key, d.source AS source, d.confidence AS confidence, d.updated_at AS updated_at`,
      fromSql: `FROM organizations o ${portal ? "LEFT JOIN" : "JOIN"} counted d ON d.organization_id = o.id AND d.rank = 1
        WHERE ${where.join(" AND ")}`,
      bindings: [
        ...scope.bindings,
        ...(query.ticketKey ? [query.ticketKey] : []),
        ...(name?.bindings ?? []),
        ...(domain?.bindings ?? []),
      ],
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { organization: "organization_name", updated: "updated_at" },
      portal ? "organization_name ASC" : "updated_at DESC",
      "organization_id ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return eventTicketOrganizationListSchema.parse({
    organizations: rows.map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      domains: splitDomains(row.domains),
      ticketKey: row.ticket_key,
      decidedBy: row.source === null ? null : row.source === "organizer" ? "organizer" : "classifier",
      confidencePercent: row.source === null ? null : certainty(row.source, row.confidence),
      updatedAt: row.updated_at,
    })),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}

/** The event's tickets with an unsaved edit in place of the saved ticket, or beside them for a new one. */
function withDraft(types: readonly TicketTypeRow[], draft: EventTicketClassifierDraft): TicketTypeRow[] {
  const saved = draft.ticketTypeId === null ? undefined : types.find((type) => type.id === draft.ticketTypeId);
  if (draft.ticketTypeId !== null && !saved)
    throw new AppError(409, "EVENT_TICKETS_CHANGED", "This ticket is no longer available. Reload and try again.");
  const edited: TicketTypeRow = {
    id: "draft",
    event_id: "",
    name: "",
    description_markdown: "",
    is_default: 0,
    free_requires_work_email: 0,
    sort_order: types.length,
    ...saved,
    ticket_key: draft.key,
    classifier_description: draft.classifierDescription,
    classifier_threshold: draft.classifierThresholdPercent / 100,
    active: draft.active ? 1 : 0,
  };
  // Another ticket with the drafted key would be asked about twice.
  const others = types.filter((type) => type.id !== saved?.id && type.ticket_key !== draft.key);
  return [...others, edited];
}

/** How many organizations the classifier is asked about at once. */
const TRIAL_CONCURRENCY = 5;

/** Runs the work for every item, a few at a time, and returns the results in the items' order. */
async function mapConcurrently<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]!);
      }
    }),
  );
  return results;
}

/** A typed organization as the classifier reads it: personal mail domains are left out, as at registration. */
function typedSubject(subject: { organizationName: string; domains: readonly string[] }): TicketClassifierSubject {
  const domains = [...new Set(subject.domains.flatMap((value) => workEmailDomain(value) ?? []))];
  return { organizationId: null, organizationName: subject.organizationName, domains };
}

/** Asks the classifier as registration would for each organization, and stores nothing. */
export async function testTicketOrganizations(
  db: DatabaseLike,
  env: Pick<Env, "AI" | "TICKET_CLASSIFIER_MODEL">,
  event: TicketEvent,
  input: EventTicketOrganizationTrial,
): Promise<EventTicketOrganizationTrialResponse> {
  const saved = await readTypes(db, event);
  const types = input.draft ? withDraft(saved, input.draft) : saved;
  const options = classifierOptions(types);
  if (options.length < 2)
    throw new AppError(
      409,
      "TICKET_CLASSIFIER_OFF",
      "Describe who qualifies for at least two tickets before testing the classifier.",
    );
  const portal = await readOrganizationSubjects(
    db,
    input.organizations.flatMap((subject) => ("organizationId" in subject ? [subject.organizationId] : [])),
  );
  const subjectOf = (given: TicketOrganizationSubject) =>
    "organizationId" in given ? portal.get(given.organizationId) : typedSubject(given);
  const results = await mapConcurrently(
    input.organizations,
    TRIAL_CONCURRENCY,
    async (given): Promise<EventTicketOrganizationTrialResult> => {
      const subject = subjectOf(given);
      if (!subject)
        return {
          organizationId: "organizationId" in given ? given.organizationId : null,
          organizationName: "",
          domains: [],
          answers: null,
          decidedTicketKey: null,
          current: null,
          error: "not_found",
        };
      const [asked, current] = await Promise.all([
        askTicketClassifier(env, options, subject),
        // The decision that counts now, under the saved tickets.
        readStoredTicketDecision(db, saved, subject),
      ]);
      const answered = {
        organizationId: subject.organizationId,
        organizationName: subject.organizationName ?? "",
        domains: [...subject.domains],
        current: current
          ? {
              ticketKey: current.ticketKey,
              decidedBy: current.source,
              confidencePercent: certainty(current.source, current.confidence),
            }
          : null,
      };
      if (!asked) return { ...answered, answers: null, decidedTicketKey: null, error: "unavailable" };
      const decided = decideClassifiedTicket(options, asked.probabilities);
      return {
        ...answered,
        answers: options
          .map((option) => ({
            ticketKey: option.key,
            percent: percent(asked.probabilities[option.key] ?? 0),
            thresholdPercent: percent(option.threshold),
          }))
          .sort((a, b) => b.percent - a.percent),
        decidedTicketKey: decided?.key ?? null,
        error: null,
      };
    },
  );
  if (results.every((result) => result.error === "unavailable"))
    throw new AppError(503, "TICKET_CLASSIFIER_UNAVAILABLE", "The classifier did not answer. Try again.");
  return { results };
}

/** The statements that save one organizer's decision, which the classifier never replaces. */
function prepareTicketOrganizationDecision(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: TicketEvent,
  types: readonly TicketTypeRow[],
  input: EventTicketOrganizationDecisions["decisions"][number],
): StatementLike[] {
  return [
    ...prepareOrganizerTicketDecision(db, types, { ...input, decidedByUserId: actor.id }),
    prepareAuditLog(db, "user", actor.id, "ticket_organization_decided", "event", event.id, {
      organizationId: input.organizationId,
      ticketKey: input.ticketKey,
    }),
  ];
}

/** Organizers' decisions, saved together behind one permission guard: all of them or none. */
export async function decideTicketOrganizations(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: TicketEvent,
  input: EventTicketOrganizationDecisions,
): Promise<void> {
  const snapshot = await readEventTicketSnapshot(db, event);
  const types = snapshot.types;
  const offered = new Set(types.filter((type) => type.active === 1).map((type) => type.ticket_key));
  if (input.decisions.some((decision) => !offered.has(decision.ticketKey)))
    throw new AppError(409, "TICKET_NOT_OFFERED", "This event does not offer that ticket. Reload and choose another.");
  const organizationIds = [...new Set(input.decisions.map((decision) => decision.organizationId))];
  const found = await readOrganizationSubjects(db, organizationIds);
  if (organizationIds.some((id) => !found.has(id)))
    throw new AppError(
      404,
      "TICKET_ORGANIZATION_NOT_FOUND",
      "An organization is no longer in the portal. Reload the list and try again.",
    );
  await commitDecisionChange(db, [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: event.id } },
    ]),
    // The tickets and organizations as they were checked: a ticket renamed or an organization merged meanwhile
    // writes nothing.
    prepareStateGuard(db, {
      sql: "SELECT 1 WHERE COALESCE((SELECT revision FROM event_ticket_settings WHERE event_id = ?), 0) = ?",
      bindings: [event.id, snapshot.settings?.revision ?? 0],
    }),
    prepareStateGuard(db, {
      sql: `SELECT 1 WHERE (SELECT COUNT(*) FROM organizations
              WHERE id IN (SELECT value FROM json_each(?)) AND merged_into_organization_id IS NULL) = ?`,
      bindings: [JSON.stringify(organizationIds), organizationIds.length],
    }),
    ...input.decisions.flatMap((decision) => prepareTicketOrganizationDecision(db, actor, event, types, decision)),
  ]);
}

async function commitDecisionChange(db: DatabaseLike, statements: StatementLike[]): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    if (isStateGuardFailure(error))
      throw new AppError(
        409,
        "TICKET_DECISIONS_CHANGED",
        "The tickets or organizations changed meanwhile. Reload and try again.",
      );
    throw error;
  }
}

/** Clears every decision that counts for the organization, so the next registration asks the classifier again. */
export async function clearTicketOrganizationDecision(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: TicketEvent,
  decisionId: string,
): Promise<void> {
  const scope = decisionsInScope(await readTypes(db, event));
  const row = await first<{ organization_id: string; updated_at: string }>(
    db,
    `SELECT organization_id, updated_at FROM ticket_organization_decisions WHERE id = ? AND ${scope.where}`,
    [decisionId, ...scope.bindings],
  );
  if (!row) throw new AppError(404, "TICKET_DECISION_NOT_FOUND", "This event has no such decision. Reload the list.");
  await commitDecisionChange(db, [
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: event.id } },
    ]),
    // The decision as it was read: one replaced or moved by a merge meanwhile clears nothing.
    prepareStateGuard(db, {
      sql: "SELECT 1 FROM ticket_organization_decisions WHERE id = ? AND organization_id = ? AND updated_at = ?",
      bindings: [decisionId, row.organization_id, row.updated_at],
    }),
    db
      .prepare(`DELETE FROM ticket_organization_decisions WHERE organization_id = ? AND ${scope.where}`)
      .bind(row.organization_id, ...scope.bindings),
    prepareAuditLog(db, "user", actor.id, "ticket_organization_decision_cleared", "event", event.id, {
      organizationId: row.organization_id,
    }),
  ]);
}
