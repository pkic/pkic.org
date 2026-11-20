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
import {
  ACCOUNT_DELETION_COUNT_EXPRESSIONS,
  ACCOUNT_DELETION_LINKED_ADDRESSES_SQL,
  ACCOUNT_DELETION_RENDER_FILES_SQL,
} from "./selection";

/** Former addresses an account's audit history can name; well above any real account. */
const AUDITED_ADDRESS_LIMIT = 200;
/** A whole value that is one address, never a note that mentions one. */
const WHOLE_ADDRESS = /^[^\s@]+@[^\s@]+$/;

/** D1 refuses very wide result rows; 30 counts per statement stays well inside its limits. */
const COUNTS_PER_STATEMENT = 30;

export interface AccountDeletionAccount {
  id: string;
  email: string;
  normalized_email: string;
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
  /**
   * Every spelling of those addresses as stored, plus any address that earlier
   * audit details about the account name (a removed or replaced address), for
   * redacting those details.
   */
  spellings: string[];
  /** The linked addresses, normalized, sorted, and space-separated; null without any. */
  linkedAddresses: string | null;
  /** The renders whose files the delete queues; the batch refuses if they changed. */
  renderFiles: string | null;
  /** Rows per removed table, in registry order; the delete batch requires the same counts. */
  removedCounts: number[];
  /** Badge and promotion renders; their rows go with the account, their files through the outbox. */
  renders: AccountDeletionRender[];
  preview: AccountDeletionPreview;
}

/**
 * Sums the counts per kind. A part of another record (`counted: false`) only
 * counts when its kind has no record of its own, so a proposal with three
 * speakers is one proposal.
 */
function tally<Kind extends string>(
  kinds: readonly Kind[],
  entries: readonly { kind: Kind; counted?: false }[],
  counts: readonly number[],
): AccountDeletionCount<Kind>[] {
  const records = new Map<Kind, number>();
  const parts = new Map<Kind, number>();
  entries.forEach((entry, index) => {
    const totals = entry.counted === false ? parts : records;
    totals.set(entry.kind, (totals.get(entry.kind) ?? 0) + counts[index]);
  });
  return kinds.flatMap((kind) => {
    const count = records.get(kind) || parts.get(kind) || 0;
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
  const [accountResult, addressResult, fingerprintResult, renderResult, auditedResult, ...countResults] =
    await db.batch([
      db
        .prepare(
          "SELECT id, email, normalized_email, updated_at, pii_redacted_at, headshot_r2_key FROM users WHERE id = ?1",
        )
        .bind(userId),
      db
        .prepare("SELECT email, normalized_email FROM user_emails WHERE user_id = ?1 ORDER BY created_at, id")
        .bind(userId),
      db
        .prepare(
          `SELECT ${ACCOUNT_DELETION_LINKED_ADDRESSES_SQL} AS linked, ${ACCOUNT_DELETION_RENDER_FILES_SQL} AS render_files`,
        )
        .bind(userId),
      db.prepare("SELECT id, format, cache_key FROM event_promotion_renders WHERE user_id = ?1").bind(userId),
      db
        .prepare(
          `SELECT DISTINCT j.value AS address
           FROM audit_log a, json_tree(a.details_json) j
          WHERE a.entity_type = 'user' AND a.entity_id = ?1 AND json_valid(a.details_json)
            AND j.type = 'text' AND j.value LIKE '%_@_%' AND j.value NOT GLOB '*[ ]*'
          LIMIT ${AUDITED_ADDRESS_LIMIT}`,
        )
        .bind(userId),
      ...countStatements,
    ]);
  const account = accountResult.results?.[0] as AccountDeletionAccount | undefined;
  if (!account) throw new AppError(404, "NOT_FOUND", "User not found");
  if (account.pii_redacted_at) throw new AppError(409, "ALREADY_ANONYMIZED", "User has already been anonymized");

  const counts = countResults.flatMap((result) => Object.values(result.results?.[0] ?? {}).map(Number));
  const removedCounts = counts.slice(0, ACCOUNT_DELETION_REMOVED_TABLES.length);
  const blockerCounts = counts.slice(ACCOUNT_DELETION_REMOVED_TABLES.length);
  const removes = tally(ACCOUNT_DELETION_REMOVED_KINDS, ACCOUNT_DELETION_REMOVED_TABLES, removedCounts);
  const blockers = tally(ACCOUNT_DELETION_BLOCKER_KINDS, ACCOUNT_DELETION_BLOCKING_RULES, blockerCounts);
  const fingerprint = fingerprintResult.results?.[0];
  const addressRows = (addressResult.results ?? []) as { email: string; normalized_email: string }[];
  const addresses = [...new Set([account.normalized_email, ...addressRows.map((row) => row.normalized_email)])];
  const audited = (auditedResult.results ?? [])
    .map((row) => String(row.address))
    .filter((value) => WHOLE_ADDRESS.test(value));
  const spellings = [
    ...new Set([account.email, ...addresses, ...addressRows.map((row) => row.email), ...audited].filter(Boolean)),
  ];
  const linkedAddresses = (fingerprint?.linked as string | null | undefined) ?? null;
  const renderFiles = (fingerprint?.render_files as string | null | undefined) ?? null;
  // Everything the delete batch re-checks, so a preview with a stale revision is refused before the batch.
  const revision = await sha256Hex(
    JSON.stringify([account.updated_at, account.email, addresses, linkedAddresses, renderFiles, counts]),
  );
  return {
    account,
    addresses,
    spellings,
    linkedAddresses,
    renderFiles,
    removedCounts,
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
