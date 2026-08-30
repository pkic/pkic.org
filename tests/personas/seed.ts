import { env } from "cloudflare:test";
import { createAdminSession, createMemberSession } from "../helpers/auth";
import { addRepresentative, insertOrganization, insertUser, seedOrganizationAggregate } from "../helpers/membership";
import { joinGroup } from "../../functions/_lib/services/groups";
import type { DatabaseLike } from "../../functions/_lib/types";
import { PERSONAS, type PersonaDefinition, type PersonaKey } from "./catalog";

/**
 * Brings a persona into existence in D1 for the mounted Worker suites.
 *
 * Everything is created through the same primitives the product uses, so a
 * seeded persona holds authority the same way a real one does rather than by
 * a test-only shortcut.
 */
export interface SeededPersona {
  key: PersonaKey;
  definition: PersonaDefinition;
  userId: string;
  email: string;
  /** One entry per represented organization, in creation order. */
  capacities: Array<{ organizationId: string; memberId: string }>;
  /** Bearer token, or null for the anonymous persona. */
  token: string | null;
}

export interface SeedPersonaOptions {
  /** The group a group-scoped role applies to, and which the persona joins. */
  groupId?: string;
  /** The event an event-scoped role applies to. */
  eventId?: string;
  /** Join `groupId` with every capacity, so group journeys have a participant. */
  joinGroupWithCapacities?: boolean;
}

export async function seedPersona(
  db: DatabaseLike,
  key: PersonaKey,
  options: SeedPersonaOptions = {},
): Promise<SeededPersona> {
  const definition = PERSONAS[key];
  if (key === "anonymous") {
    return { key, definition, userId: "", email: "", capacities: [], token: null };
  }

  const email = `${key.toLowerCase()}-${crypto.randomUUID().slice(0, 8)}@persona.test`;
  const userId = await insertUser(db, email);

  const capacities: SeededPersona["capacities"] = [];
  for (let index = 0; index < definition.organizationCount; index += 1) {
    const organizationId = await insertOrganization(db, `${definition.description} ${index + 1}`);
    const memberId = await seedOrganizationAggregate(db, organizationId, definition.membershipCategory ?? "A");
    await addRepresentative(db, memberId, userId);
    capacities.push({ organizationId, memberId });
  }

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
    await db
      .prepare(
        `INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, granted_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .bind(
        crypto.randomUUID(),
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

  for (const permission of definition.grants) {
    await db
      .prepare(
        `INSERT INTO permission_grants (id, user_id, permission, granted_by_user_id, created_at)
         VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      )
      .bind(crypto.randomUUID(), userId, permission, userId)
      .run();
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

  return { key, definition, userId, email, capacities, token };
}

/** Convenience for suites that only need the request header. */
export function personaRequest(persona: SeededPersona, path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (persona.token) headers.set("authorization", `Bearer ${persona.token}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return new Request(new URL(path, "https://app.test"), { ...init, headers });
}

export { env };
