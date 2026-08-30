import { env } from "cloudflare:test";
import { createAdminSession, createMemberSession } from "../helpers/auth";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "../helpers/membership";
import { joinGroup } from "../../functions/_lib/services/groups";
import type { DatabaseLike } from "../../functions/_lib/types";
import { ALL_PERSONAS, type PersonaDefinition } from "./catalog";

/**
 * Brings a persona into existence in D1 for the mounted Worker suites.
 *
 * Everything is created through the same primitives the product uses, so a
 * seeded persona holds authority the same way a real one does rather than by
 * a test-only shortcut.
 */
export interface SeededPersona {
  key: string;
  definition: PersonaDefinition;
  userId: string;
  email: string;
  /** One entry per represented organization, in creation order. */
  capacities: Array<{ organizationId: string; memberId: string }>;
  /** Bearer token, or null for the anonymous persona. */
  token: string | null;
  /**
   * The row id of each direct grant, so a test can revoke one mid-request and
   * check the authorization is re-evaluated rather than trusted from preflight.
   */
  grantIds: Map<string, string>;
  /**
   * The row id of each role assignment, for the same reason as `grantIds`: a
   * test that revokes a role mid-request needs to name the row.
   */
  roleAssignmentIds: Map<string, string>;
}

export interface SeedPersonaOptions {
  /** The group a group-scoped role applies to, and which the persona joins. */
  groupId?: string;
  /** The event an event-scoped role applies to. */
  eventId?: string;
  /** Join `groupId` with every capacity, so group journeys have a participant. */
  joinGroupWithCapacities?: boolean;
}

/**
 * Combines several named profiles into one definition.
 *
 * Real people do hold more than one capability — somebody may run the
 * scheduler and also hold the retention permissions it dispatches. Composing
 * named profiles keeps that expressible without reopening the door to
 * arbitrary permission lists, which is how a test ends up asserting on an
 * authority the product never issues.
 */
function composed(keys: string[]): PersonaDefinition {
  const definitions = keys.map((key) => {
    const definition = ALL_PERSONAS[key];
    if (!definition) throw new Error(`Unknown persona: ${key}`);
    return definition;
  });
  return {
    key: keys.join("+"),
    description: definitions.map((definition) => definition.description).join("; also "),
    membershipCategory: definitions.find((definition) => definition.membershipCategory)?.membershipCategory ?? null,
    organizationCount: Math.max(...definitions.map((definition) => definition.organizationCount)),
    roles: definitions.flatMap((definition) => definition.roles),
    grants: [...new Set(definitions.flatMap((definition) => definition.grants))],
    mayVote: definitions.some((definition) => definition.mayVote),
  } satisfies PersonaDefinition & { key: string } as PersonaDefinition & { key: string } extends never
    ? never
    : PersonaDefinition;
}

export async function seedPersona(
  db: DatabaseLike,
  key: string | string[],
  options: SeedPersonaOptions = {},
): Promise<SeededPersona> {
  const keys = Array.isArray(key) ? key : [key];
  const definition = keys.length === 1 ? ALL_PERSONAS[keys[0]] : composed(keys);
  if (!definition) throw new Error(`Unknown persona: ${keys.join(", ")}`);
  key = keys.join("+");
  if (key === "anonymous") {
    return {
      key,
      definition,
      userId: "",
      email: "",
      capacities: [],
      token: null,
      grantIds: new Map(),
      roleAssignmentIds: new Map(),
    };
  }

  // Every instance is a distinct person at a distinct organization. Deriving
  // the organization name from the persona description alone collides on
  // `organizations.normalized_name` the moment a test needs two chairs.
  const instance = crypto.randomUUID().slice(0, 8);
  const email = `${key.toLowerCase()}-${instance}@persona.test`;
  const userId = await insertUser(db, email);

  const capacities: SeededPersona["capacities"] = [];
  for (let index = 0; index < definition.organizationCount; index += 1) {
    const organizationId = await insertOrganization(db, `${definition.description} ${index + 1} ${instance}`);
    const memberId = await seedOrganizationAggregate(db, organizationId, definition.membershipCategory ?? "A");
    await addRepresentative(db, memberId, userId);
    capacities.push({ organizationId, memberId });
  }

  const roleAssignmentIds = new Map<string, string>();
  for (const role of definition.roles) {
    const contextId =
      role.context === "group"
        ? options.groupId
        : role.context === "event"
          ? options.eventId
          : role.context === "organization"
            ? // An organization-scoped contact role keys on the members
              // aggregate, not the organization: a D1 trigger requires a
              // matching active representative for exactly that member_id.
              capacities[0]?.memberId
            : null;
    if (role.context !== "global" && !contextId) {
      throw new Error(`Persona ${key} needs a ${role.context} context for ${role.roleId}`);
    }
    const roleAssignmentId = crypto.randomUUID();
    roleAssignmentIds.set(role.roleId, roleAssignmentId);
    await db
      .prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .bind(
        roleAssignmentId,
        userId,
        role.roleId,
        // A global role carries no context at all: the schema's context
        // vocabulary is event/group/organization, and a NULL type with a
        // non-NULL id (or the reverse) is rejected outright.
        role.context === "global" ? null : role.context,
        role.context === "global" ? null : contextId,
        userId,
      )
      .run();
  }

  const grantIds = new Map<string, string>();
  for (const permission of definition.grants) {
    const grantId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .bind(grantId, userId, permission, userId)
      .run();
    grantIds.set(permission, grantId);
  }

  if (options.groupId && options.joinGroupWithCapacities && capacities.length > 0) {
    await joinGroup(db, options.groupId, {
      actorUserId: userId,
      targetUserId: userId,
      selection: { mode: "selected", memberIds: capacities.map((capacity) => capacity.memberId) },
      source: "self_service",
      allowManaged: false,
    });
  }

  // A persona with any staff authority needs a staff session; a pure member
  // needs a member session. Issuing the wrong one would let a test pass for
  // an identity shape the product never produces.
  const hasStaffAuthority =
    definition.roles.some((role) => role.roleId !== "role-primary_contact") || definition.grants.length > 0;
  const token = hasStaffAuthority
    ? await createAdminSession(db, userId, `persona-${key}-${crypto.randomUUID()}`)
    : await createMemberSession(db, userId, `persona-${key}-${crypto.randomUUID()}`);

  return { key, definition, userId, email, capacities, token, grantIds, roleAssignmentIds };
}

/** Convenience for suites that only need the request header. */
export function personaRequest(persona: SeededPersona, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (persona.token) headers.set("authorization", `Bearer ${persona.token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(new URL(path, "https://app.test"), { ...init, headers });
}

export { env };
