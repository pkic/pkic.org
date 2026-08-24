import type {
  Group,
  GroupCategoryRulesReplaceInput,
  GroupCreateInput,
  GroupType,
  GroupTypesListQuery,
  GroupUpdateInput,
} from "../../../../assets/shared/schemas/groups";
import { serializeLinks } from "../../../../assets/shared/schemas/links";
import { queryPage } from "../../db/pagination";
import { first } from "../../db/queries";
import { buildD1TextSearchFilter } from "../../db/search";
import { resolveMappedOrderBy } from "../../db/sort";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import { prepareAutomaticGroupEnrollmentForGroupStatements } from "./automatic-enrollment-group";
import { canEnableLocalOnlyGovernance, requireGroupManagement } from "./governance";
import { getGroup } from "./read-model";

interface GroupTypeRow {
  key: string;
  singular_label: string;
  plural_label: string;
  description: string | null;
  default_governance_inheritance_mode: GroupType["defaultGovernanceInheritanceMode"];
  default_eligibility_mode: GroupType["defaultEligibilityMode"];
  default_automatic_enrollment_mode: GroupType["defaultAutomaticEnrollmentMode"];
  default_allow_automatic_opt_out: number;
  default_visibility: GroupType["defaultVisibility"];
  active: number;
  sort_order: number;
}

function mapGroupType(row: GroupTypeRow): GroupType {
  return {
    key: row.key,
    singularLabel: row.singular_label,
    pluralLabel: row.plural_label,
    description: row.description,
    defaultGovernanceInheritanceMode: row.default_governance_inheritance_mode,
    defaultEligibilityMode: row.default_eligibility_mode,
    defaultAutomaticEnrollmentMode: row.default_automatic_enrollment_mode,
    defaultAllowAutomaticOptOut: row.default_allow_automatic_opt_out === 1,
    defaultVisibility: row.default_visibility,
    active: row.active === 1,
    sortOrder: row.sort_order,
  };
}

export async function listGroupTypes(
  db: DatabaseLike,
  query: GroupTypesListQuery,
): Promise<{ groupTypes: GroupType[]; total: number }> {
  const search = query.q
    ? buildD1TextSearchFilter(query.q, ["gt.key", "gt.singular_label", "gt.plural_label", "gt.description"])
    : null;
  const conditions: string[] = [];
  const bindings: unknown[] = [];
  if (search) {
    conditions.push(search.sql);
    bindings.push(...search.bindings);
  }
  if (query.active !== undefined) {
    conditions.push("gt.active = ?");
    bindings.push(query.active ? 1 : 0);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows, total } = await queryPage<GroupTypeRow>(db, {
    source: {
      selectSql: `SELECT gt.key, gt.singular_label, gt.plural_label, gt.description,
        gt.default_governance_inheritance_mode, gt.default_eligibility_mode,
        gt.default_automatic_enrollment_mode, gt.default_allow_automatic_opt_out,
        gt.default_visibility, gt.active, gt.sort_order`,
      fromSql: `FROM group_types gt ${where}`,
      bindings,
    },
    orderBy: resolveMappedOrderBy(
      query.sort,
      { sort_order: "gt.sort_order", singular_label: "gt.singular_label COLLATE NOCASE", key: "gt.key" },
      "gt.sort_order ASC",
      "gt.key ASC",
    ),
    limit: query.limit,
    offset: query.offset,
  });
  return { groupTypes: rows.map(mapGroupType), total };
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function availableSlug(db: DatabaseLike, requested: string): Promise<string> {
  const root = slugify(requested) || "group";
  let candidate = root;
  for (let suffix = 2; await first(db, "SELECT id FROM groups WHERE slug = ?", [candidate]); suffix += 1) {
    candidate = `${root}-${suffix}`;
  }
  return candidate;
}

async function requireActiveGroupType(db: DatabaseLike, key: string): Promise<GroupTypeRow> {
  const type = await first<GroupTypeRow>(
    db,
    `SELECT key, singular_label, plural_label, description,
            default_governance_inheritance_mode, default_eligibility_mode,
            default_automatic_enrollment_mode, default_allow_automatic_opt_out,
            default_visibility, active, sort_order
       FROM group_types WHERE key = ? AND active = 1`,
    [key],
  );
  if (!type) throw new AppError(400, "GROUP_TYPE_INVALID", "The selected group type is not active");
  return type;
}

async function requireParent(db: DatabaseLike, parentGroupId: string): Promise<void> {
  if (!(await first(db, "SELECT id FROM groups WHERE id = ? AND active = 1", [parentGroupId]))) {
    throw new AppError(400, "GROUP_PARENT_INVALID", "The selected parent group is not active");
  }
}

function translateGroupWriteError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("UNIQUE constraint failed: groups.slug")) {
    throw new AppError(409, "GROUP_SLUG_EXISTS", "A group with this slug already exists");
  }
  if (message.includes("group hierarchy cycle")) {
    throw new AppError(409, "GROUP_HIERARCHY_CYCLE", "A group cannot contain itself through its parent hierarchy");
  }
  if (
    message.includes("automatic enrollment groups must be top-level") ||
    message.includes("automatic enrollment groups cannot be structural parents") ||
    message.includes("a structural parent cannot enable automatic enrollment")
  ) {
    throw new AppError(
      409,
      "GROUP_AUTOMATIC_ENROLLMENT_HIERARCHY",
      "Automatic-enrollment groups must be top-level and cannot be structural parents",
    );
  }
  throw error;
}

export async function createGroup(db: DatabaseLike, actor: AuthAdmin, input: GroupCreateInput): Promise<Group> {
  const type = await requireActiveGroupType(db, input.typeKey);
  if (input.parentGroupId) {
    await requireParent(db, input.parentGroupId);
    await requireGroupManagement(db, actor, input.parentGroupId);
  } else if (!hasGlobalGroupWrite(actor)) {
    throw new AppError(403, "GROUP_CREATE_REQUIRED", "Global group management permission is required");
  }
  const governanceMode = input.governanceInheritanceMode ?? type.default_governance_inheritance_mode;
  if (input.parentGroupId && governanceMode === "local_only") {
    throw new AppError(
      409,
      "GROUP_LOCAL_LEADERSHIP_REQUIRED",
      "Create the group with inherited governance, assign local leadership, then enable local-only governance",
    );
  }
  const id = uuid();
  const at = nowIso();
  const slug = input.slug ?? (await availableSlug(db, input.name));
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO groups
             (id, type_key, parent_group_id, name, slug, description, links_json, visibility,
              governance_inheritance_mode, eligibility_mode, automatic_enrollment_mode,
              allow_automatic_opt_out, min_endorsers_for_ballot, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(
          id,
          input.typeKey,
          input.parentGroupId ?? null,
          input.name,
          slug,
          input.description ?? null,
          serializeLinks(input.links ?? []),
          input.visibility ?? type.default_visibility,
          governanceMode,
          input.eligibilityMode ?? type.default_eligibility_mode,
          input.automaticEnrollmentMode ?? type.default_automatic_enrollment_mode,
          (input.allowAutomaticOptOut ?? type.default_allow_automatic_opt_out === 1) ? 1 : 0,
          input.minEndorsersForBallot ?? 0,
          at,
          at,
        ),
      prepareScopedAuditLog(db, { type: "group", id }, "admin", actor.id, "group_created", "group", id, {
        name: input.name,
        typeKey: input.typeKey,
        parentGroupId: input.parentGroupId ?? null,
      }),
    ]);
  } catch (error) {
    translateGroupWriteError(error);
  }
  const created = await getGroup(db, id);
  if (!created) throw new AppError(500, "GROUP_CREATE_FAILED", "Failed to load the created group");
  return created;
}

function hasGlobalGroupWrite(actor: AuthAdmin): boolean {
  if (actor.scopeRestricted && actor.scopes?.includes("groups:write") !== true) return false;
  if (actor.role === "admin") return true;
  return (actor.grants ?? []).some(
    (grant) => grant.permission === "groups:write" && grant.contextType === null && grant.contextId === null,
  );
}

async function assertLocalOnlyTransition(db: DatabaseLike, actor: AuthAdmin, groupId: string): Promise<void> {
  if (!(await canEnableLocalOnlyGovernance(db, actor, groupId))) {
    throw new AppError(
      403,
      "GROUP_INHERITED_MANAGEMENT_REQUIRED",
      "Only inherited or global management may enable local-only governance",
    );
  }
  if (
    !(await first(
      db,
      `SELECT id FROM user_roles
        WHERE context_type = 'group' AND context_id = ?
          AND role_id IN ('role-group_lead', 'role-group_deputy_lead')
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        LIMIT 1`,
      [groupId],
    ))
  ) {
    throw new AppError(
      409,
      "GROUP_LOCAL_LEADERSHIP_REQUIRED",
      "Assign local leadership before enabling local-only governance",
    );
  }
}

export async function updateGroup(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  patch: GroupUpdateInput,
): Promise<Group> {
  const existing = await getGroup(db, groupIdOrSlug);
  if (!existing) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupManagement(db, actor, existing.id);
  if (patch.typeKey) await requireActiveGroupType(db, patch.typeKey);
  if (patch.parentGroupId) {
    await requireParent(db, patch.parentGroupId);
    await requireGroupManagement(db, actor, patch.parentGroupId);
  }
  if (patch.governanceInheritanceMode === "local_only" && existing.governanceInheritanceMode !== "local_only") {
    await assertLocalOnlyTransition(db, actor, existing.id);
  }

  const setters: string[] = [];
  const bindings: unknown[] = [];
  const add = (column: string, value: unknown) => {
    setters.push(`${column} = ?`);
    bindings.push(value);
  };
  if (patch.typeKey !== undefined) add("type_key", patch.typeKey);
  if (patch.parentGroupId !== undefined) add("parent_group_id", patch.parentGroupId);
  if (patch.name !== undefined) add("name", patch.name);
  if (patch.slug !== undefined) add("slug", patch.slug);
  if (patch.description !== undefined) add("description", patch.description);
  if (patch.links !== undefined) add("links_json", serializeLinks(patch.links));
  if (patch.visibility !== undefined) add("visibility", patch.visibility);
  if (patch.active !== undefined) add("active", patch.active ? 1 : 0);
  if (patch.governanceInheritanceMode !== undefined)
    add("governance_inheritance_mode", patch.governanceInheritanceMode);
  if (patch.eligibilityMode !== undefined) add("eligibility_mode", patch.eligibilityMode);
  if (patch.automaticEnrollmentMode !== undefined) add("automatic_enrollment_mode", patch.automaticEnrollmentMode);
  if (patch.allowAutomaticOptOut !== undefined) add("allow_automatic_opt_out", patch.allowAutomaticOptOut ? 1 : 0);
  if (patch.minEndorsersForBallot !== undefined) add("min_endorsers_for_ballot", patch.minEndorsersForBallot);
  if (setters.length === 0) return existing;
  const at = nowIso();
  add("updated_at", at);
  try {
    const statements: StatementLike[] = [
      db.prepare(`UPDATE groups SET ${setters.join(", ")} WHERE id = ?`).bind(...bindings, existing.id),
      prepareScopedAuditLog(
        db,
        { type: "group", id: existing.id },
        "admin",
        actor.id,
        "group_updated",
        "group",
        existing.id,
        patch,
      ),
    ];
    if (
      patch.active !== undefined ||
      patch.eligibilityMode !== undefined ||
      patch.automaticEnrollmentMode !== undefined ||
      patch.allowAutomaticOptOut !== undefined
    ) {
      statements.push(...prepareAutomaticGroupEnrollmentForGroupStatements(db, existing.id, at));
    }
    await db.batch(statements);
  } catch (error) {
    translateGroupWriteError(error);
  }
  const updated = await getGroup(db, existing.id);
  if (!updated) throw new AppError(500, "GROUP_UPDATE_FAILED", "Failed to load the updated group");
  return updated;
}

export async function replaceGroupCategoryRules(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  input: GroupCategoryRulesReplaceInput,
): Promise<void> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupManagement(db, actor, group.id);
  const at = nowIso();
  const statements: StatementLike[] = [
    db.prepare("DELETE FROM group_membership_category_rules WHERE group_id = ?").bind(group.id),
    ...input.rules.map((rule) =>
      db
        .prepare(
          `INSERT INTO group_membership_category_rules
             (group_id, membership_category_code, permits_join, automatic_enrollment, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(group.id, rule.membershipCategory, rule.permitsJoin ? 1 : 0, rule.automaticEnrollment ? 1 : 0, at, at),
    ),
    prepareScopedAuditLog(
      db,
      { type: "group", id: group.id },
      "admin",
      actor.id,
      "group_category_rules_replaced",
      "group",
      group.id,
      {
        rules: input.rules,
      },
    ),
    ...prepareAutomaticGroupEnrollmentForGroupStatements(db, group.id, at),
  ];
  await db.batch(statements);
}
