import {
  ACCOUNT_DELETION_BLOCKER_KINDS,
  ACCOUNT_DELETION_REMOVED_KINDS,
  isAccountDeletable,
  type AccountDeletionCount,
} from "../../../../assets/shared/account-deletion";
import type { AccountDeletionPreview } from "../../../../assets/shared/schemas/account-deletion";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { sha256Hex } from "../../utils/crypto";
import { ACCOUNT_DELETION_BLOCKING_RULES, ACCOUNT_DELETION_REMOVED_TABLES } from "./registry";
import { ACCOUNT_DELETION_COUNT_EXPRESSIONS } from "./selection";

/** D1 refuses very wide result rows; 30 counts per statement stays well inside its limits. */
const COUNTS_PER_STATEMENT = 30;

export interface AccountDeletionAccount {
  id: string;
  email: string;
  updated_at: string;
  pii_redacted_at: string | null;
  headshot_r2_key: string | null;
}

export interface AccountDeletionRender {
  id: string;
  format: string;
  cache_key: string;
}

export interface AccountDeletionState {
  account: AccountDeletionAccount;
  /** Every address on the account, primary first, normalized. */
  addresses: string[];
  /** Badge and promotion renders; their rows go with the account, their files through the outbox. */
  renders: AccountDeletionRender[];
  preview: AccountDeletionPreview;
}

function tally<Kind extends string>(
  kinds: readonly Kind[],
  entries: readonly { kind: Kind }[],
  counts: readonly number[],
): AccountDeletionCount<Kind>[] {
  const totals = new Map<Kind, number>();
  entries.forEach((entry, index) => totals.set(entry.kind, (totals.get(entry.kind) ?? 0) + counts[index]));
  return kinds.flatMap((kind) => {
    const count = totals.get(kind) ?? 0;
    return count > 0 ? [{ kind, count }] : [];
  });
}

/** Reads the account, what deleting it removes, and what keeps it, in one D1 round trip. */
export async function readAccountDeletion(db: DatabaseLike, userId: string): Promise<AccountDeletionState> {
  const countStatements = [];
  for (let start = 0; start < ACCOUNT_DELETION_COUNT_EXPRESSIONS.length; start += COUNTS_PER_STATEMENT) {
    const columns = ACCOUNT_DELETION_COUNT_EXPRESSIONS.slice(start, start + COUNTS_PER_STATEMENT)
      .map((expression, offset) => `${expression} AS c${start + offset}`)
      .join(",\n");
    countStatements.push(db.prepare(`SELECT ${columns}`).bind(userId));
  }
  const [accountResult, addressResult, renderResult, ...countResults] = await db.batch([
    db
      .prepare(
        "SELECT id, email, normalized_email, updated_at, pii_redacted_at, headshot_r2_key FROM users WHERE id = ?1",
      )
      .bind(userId),
    db.prepare("SELECT normalized_email FROM user_emails WHERE user_id = ?1 ORDER BY created_at, id").bind(userId),
    db.prepare("SELECT id, format, cache_key FROM event_promotion_renders WHERE user_id = ?1").bind(userId),
    ...countStatements,
  ]);
  const account = accountResult.results?.[0] as (AccountDeletionAccount & { normalized_email: string }) | undefined;
  if (!account) throw new AppError(404, "NOT_FOUND", "User not found");
  if (account.pii_redacted_at) throw new AppError(409, "ALREADY_ANONYMIZED", "User has already been anonymized");

  const counts = countResults.flatMap((result) => Object.values(result.results?.[0] ?? {}).map(Number));
  const removedCounts = counts.slice(0, ACCOUNT_DELETION_REMOVED_TABLES.length);
  const blockerCounts = counts.slice(ACCOUNT_DELETION_REMOVED_TABLES.length);
  const removes = tally(ACCOUNT_DELETION_REMOVED_KINDS, ACCOUNT_DELETION_REMOVED_TABLES, removedCounts);
  const blockers = tally(ACCOUNT_DELETION_BLOCKER_KINDS, ACCOUNT_DELETION_BLOCKING_RULES, blockerCounts);
  const addresses = [
    ...new Set([account.normalized_email, ...(addressResult.results ?? []).map((row) => String(row.normalized_email))]),
  ];
  const revision = await sha256Hex(JSON.stringify([account.updated_at, account.email, addresses, counts]));
  return {
    account,
    addresses,
    renders: (renderResult.results ?? []) as unknown as AccountDeletionRender[],
    preview: {
      userId: account.id,
      email: account.email,
      revision,
      deletable: isAccountDeletable(blockers),
      removes,
      blockers,
    },
  };
}
