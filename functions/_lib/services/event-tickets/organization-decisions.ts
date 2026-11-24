/**
 * The ticket each organization gets, as organizers see and steer it: the
 * decisions that count for an event's tickets (or every portal organization with
 * its decision), a test of the classifier that stores nothing, organizers' own
 * decisions, and clearing a decision so the
 * classifier asks again at the next registration.
 *
 * Decisions are shared: another event that offers the same ticket finds the
 * same decision, so a change here applies there too.
 */
import {
  eventTicketOrganizationListSchema,
  type EventTicketClassifierDraft,
  type EventTicketOrganizationDecisions,
  type EventTicketOrganizationListQuery,
  type EventTicketOrganizationTrial,
  type EventTicketOrganizationTrialResponse,
  type EventTicketOrganizationTrialResult,
} from "../../../../assets/shared/schemas/event-ticket-organizations";
import { decideClassifiedTicket } from "../../../../assets/shared/event-tickets";
import { buildPageInfo } from "../../../../assets/shared/schemas/pagination";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { queryPage } from "../../db/pagination";
import { all, first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { workEmailDomain } from "../../email-domains/classification";
import { AppError } from "../../errors";
import { sha256Hex } from "../../utils/crypto";
import type { DatabaseLike, Env, StatementLike, UserBackedAuthAdmin } from "../../types";
import { prepareAuditLog } from "../audit";
import { organizationConnectionDomainsSql } from "../organization-management/read-model";
import {
  askTicketClassifier,
  classifierOptions,
  decisionsInScope,
  prepareStoreTicketDecision,
  readStoredTicketDecision,
  subjectKey,
  type TicketClassifierSubject,
} from "./classifier";
import { readEventTicketSnapshot, type TicketTypeRow } from "./snapshot";

type TicketEvent = { id: string; timezone: string };

interface DecisionRow {
  id: string | null;
  organization_id: string | null;
  organization_name: string;
  email_domain: string;
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

/** The organization as registration keys it: a personal mail domain counts as none. */
function subjectOf(input: { organizationName: string; emailDomain?: string | undefined }): TicketClassifierSubject {
  const domain = input.emailDomain?.trim();
  return { organizationName: input.organizationName, emailDomain: domain ? workEmailDomain(domain) : null };
}

async function readTypes(db: DatabaseLike, event: TicketEvent) {
  return (await readEventTicketSnapshot(db, event)).types;
}

/** The decision that counts for each name and domain, as registration finds it. */
function countedDecisionsSql(scope: ReturnType<typeof decisionsInScope>, only?: string): string {
  return `counted AS (
        SELECT id, organization_name, email_domain, ticket_key, source, confidence, updated_at,
          ROW_NUMBER() OVER (PARTITION BY organization_name, email_domain ORDER BY ${scope.precedence}) AS rank
        FROM ticket_classifier_decisions WHERE ${scope.where}${only ? ` AND ${only}` : ""})`;
}

/** One row per portal organization that is not merged away: its name and one domain, the claimed one first. */
function portalOrganizationsSql(search: string | null, domainSearch: string | null): string {
  return `portal AS (
        SELECT o.id, o.name,
          LOWER(COALESCE(
            (SELECT MIN(claim.domain) FROM organization_domain_claims claim WHERE claim.organization_id = o.id),
            (SELECT MIN(connection.domain) FROM (${organizationConnectionDomainsSql("o.id")}) connection),
            '')) AS domain
        FROM organizations o
        WHERE o.merged_into_organization_id IS NULL${
          search && domainSearch
            ? ` AND (${search} OR EXISTS (SELECT 1 FROM (${organizationConnectionDomainsSql("o.id")}) d WHERE ${domainSearch}))`
            : ""
        })`;
}

function toListedOrganization(row: DecisionRow) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    emailDomain: row.email_domain,
    ticketKey: row.ticket_key,
    decidedBy: row.source === null ? null : row.source === "organizer" ? "organizer" : "classifier",
    confidencePercent: row.source === null ? null : certainty(row.source, row.confidence),
    updatedAt: row.updated_at,
  };
}

/** One row per organization: the decision that counts for it, or every portal organization with its decision if any. */
export async function listTicketOrganizations(
  db: DatabaseLike,
  event: TicketEvent,
  query: EventTicketOrganizationListQuery,
) {
  const scope = decisionsInScope(await readTypes(db, event));
  if (query.among === "portal") return listPortalOrganizations(db, scope, query);
  const filters = [
    query.decidedBy === "organizer"
      ? "source = 'organizer'"
      : query.decidedBy === "classifier"
        ? "source <> 'organizer'"
        : "",
    query.ticketKey ? "ticket_key = ?" : "",
  ].filter(Boolean);
  const search = query.q ? buildD1TextSearchFilter(query.q, ["organization_name", "email_domain"]) : null;
  const { rows, total } = await queryPage<DecisionRow>(db, {
    source: {
      withSql: `WITH ${countedDecisionsSql(scope)}`,
      selectSql:
        "SELECT id, NULL AS organization_id, organization_name, email_domain, ticket_key, source, confidence, updated_at",
      fromSql: `FROM counted WHERE rank = 1${filters.map((filter) => ` AND ${filter}`).join("")}${search ? ` AND (${search.sql})` : ""}`,
      bindings: [...scope.bindings, ...(query.ticketKey ? [query.ticketKey] : []), ...(search?.bindings ?? [])],
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
    organizations: rows.map(toListedOrganization),
    page: buildPageInfo(query.limit, query.offset, total, rows.length),
  });
}

/**
 * A page of portal organizations, then the decision that counts for each. The decision is found by the key
 * registration uses, which folds case and inner spaces as SQL cannot, so it is computed here for the page.
 */
async function listPortalOrganizations(
  db: DatabaseLike,
  scope: ReturnType<typeof decisionsInScope>,
  query: EventTicketOrganizationListQuery,
) {
  if (query.decidedBy || query.ticketKey)
    throw new AppError(
      400,
      "TICKET_ORGANIZATION_FILTER_UNSUPPORTED",
      "Filter by who decided or by ticket only among decided organizations.",
    );
  const name = query.q ? buildD1TextSearchFilter(query.q, ["o.name"]) : null;
  const domain = query.q ? buildD1TextSearchFilter(query.q, ["d.domain"]) : null;
  const { rows, total } = await queryPage<{ organization_id: string; organization_name: string; email_domain: string }>(
    db,
    {
      source: {
        withSql: `WITH ${portalOrganizationsSql(name?.sql ?? null, domain?.sql ?? null)}`,
        selectSql: "SELECT id AS organization_id, name AS organization_name, domain AS email_domain",
        fromSql: "FROM portal",
        bindings: [...(name?.bindings ?? []), ...(domain?.bindings ?? [])],
      },
      orderBy: resolveMappedOrderBy(query.sort, { organization: "name" }, "name ASC", "id ASC"),
      limit: query.limit,
      offset: query.offset,
    },
  );
  const keyOf = (organizationName: string, emailDomain: string) => {
    const key = subjectKey(subjectOf({ organizationName, emailDomain }));
    return `${key.organizationName}\n${key.emailDomain}`;
  };
  const keys = [...new Set(rows.map((row) => keyOf(row.organization_name, row.email_domain)))];
  const decisions = keys.length
    ? await all<Omit<DecisionRow, "organization_id">>(
        db,
        `WITH ${countedDecisionsSql(scope, "(organization_name, email_domain) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?))")}
         SELECT id, organization_name, email_domain, ticket_key, source, confidence, updated_at FROM counted WHERE rank = 1`,
        [...scope.bindings, JSON.stringify(keys.map((key) => key.split("\n")))],
      )
    : [];
  const byKey = new Map(decisions.map((row) => [`${row.organization_name}\n${row.email_domain}`, row]));
  return eventTicketOrganizationListSchema.parse({
    organizations: rows.map((row) => {
      const decision = byKey.get(keyOf(row.organization_name, row.email_domain));
      return toListedOrganization({
        id: decision?.id ?? null,
        organization_id: row.organization_id,
        organization_name: row.organization_name,
        email_domain: row.email_domain,
        ticket_key: decision?.ticket_key ?? null,
        source: decision?.source ?? null,
        confidence: decision?.confidence ?? null,
        updated_at: decision?.updated_at ?? null,
      });
    }),
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
  const results = await mapConcurrently(
    input.organizations,
    TRIAL_CONCURRENCY,
    async (organization): Promise<EventTicketOrganizationTrialResult> => {
      const subject = subjectOf(organization);
      const [asked, current] = await Promise.all([
        askTicketClassifier(env, options, subject),
        // The decision that counts now, under the saved tickets.
        readStoredTicketDecision(db, saved, subject),
      ]);
      const currentDecision = current
        ? {
            ticketKey: current.ticketKey,
            decidedBy: current.source,
            confidencePercent: certainty(current.source, current.confidence),
          }
        : null;
      if (!asked)
        return {
          organizationName: organization.organizationName,
          emailDomain: subject.emailDomain,
          answers: null,
          decidedTicketKey: null,
          current: currentDecision,
          error: "unavailable",
        };
      const decided = decideClassifiedTicket(options, asked.probabilities);
      return {
        organizationName: organization.organizationName,
        emailDomain: subject.emailDomain,
        answers: options
          .map((option) => ({
            ticketKey: option.key,
            percent: percent(asked.probabilities[option.key] ?? 0),
            thresholdPercent: percent(option.threshold),
          }))
          .sort((a, b) => b.percent - a.percent),
        decidedTicketKey: decided?.key ?? null,
        current: currentDecision,
        error: null,
      };
    },
  );
  if (results.every((result) => result.error))
    throw new AppError(503, "TICKET_CLASSIFIER_UNAVAILABLE", "The classifier did not answer. Try again.");
  return { results };
}

/** The statements that save one organizer's decision, which the classifier never replaces. */
async function prepareTicketOrganizationDecision(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: TicketEvent,
  types: readonly TicketTypeRow[],
  input: EventTicketOrganizationDecisions["decisions"][number],
): Promise<StatementLike[]> {
  const subject = subjectOf(input);
  const key = subjectKey(subject);
  const offered = types.filter((type) => type.active === 1).map((type) => type.ticket_key);
  // Keyed on the tickets on offer, so events with other tickets keep their own decision.
  const criteriaDigest = await sha256Hex(`organizer:${[...offered].sort().join("\n")}`);
  return [
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
  ];
}

/** Organizers' decisions, saved together behind one permission guard: all of them or none. */
export async function decideTicketOrganizations(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  event: TicketEvent,
  input: EventTicketOrganizationDecisions,
): Promise<void> {
  const types = await readTypes(db, event);
  const offered = new Set(types.filter((type) => type.active === 1).map((type) => type.ticket_key));
  if (input.decisions.some((decision) => !offered.has(decision.ticketKey)))
    throw new AppError(409, "TICKET_NOT_OFFERED", "This event does not offer that ticket. Reload and choose another.");
  const statements = await Promise.all(
    input.decisions.map((decision) => prepareTicketOrganizationDecision(db, actor, event, types, decision)),
  );
  await db.batch([
    preparePermissionsAuthorizationGuard(db, actor, [
      { permission: "events:write", context: { type: "event", id: event.id } },
    ]),
    ...statements.flat(),
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
