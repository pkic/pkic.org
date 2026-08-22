import type {
  AdminWorkingGroupSummary,
  WorkingGroupCreateInput,
} from "../../../../assets/shared/schemas/working-groups";
import { AppError } from "../../errors";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function findAvailableSlug(db: DatabaseLike, name: string): Promise<string> {
  const root = slugify(name) || "wg";
  let candidate = root;
  let suffix = 2;
  while (await first<{ id: string }>(db, "SELECT id FROM working_groups WHERE slug = ?", [candidate])) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function createWorkingGroup(
  db: DatabaseLike,
  actorUserId: string,
  input: WorkingGroupCreateInput,
): Promise<AdminWorkingGroupSummary> {
  const existing = await first<{ id: string }>(db, "SELECT id FROM working_groups WHERE lower(name) = lower(?)", [
    input.name,
  ]);
  if (existing) {
    throw new AppError(409, "DUPLICATE", "A working group with this name already exists");
  }

  const id = uuid();
  const now = nowIso();
  const slug = await findAvailableSlug(db, input.name);

  await db.batch([
    db
      .prepare(
        `INSERT INTO working_groups
       (id, name, slug, description, mailing_list_email, min_endorsers_for_ballot, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        id,
        input.name,
        slug,
        input.description ?? null,
        input.mailingListEmail ?? null,
        input.minEndorsersForBallot ?? 0,
        now,
        now,
      ),
    prepareAuditLog(db, "admin", actorUserId, "working_group_created", "working_group", id, {
      name: input.name,
    }),
  ]);

  return {
    id,
    name: input.name,
    slug,
    description: input.description ?? null,
    mailingListEmail: input.mailingListEmail ?? null,
    minEndorsersForBallot: input.minEndorsersForBallot ?? 0,
    active: true,
    chair: null,
    viceChair: null,
    memberCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
