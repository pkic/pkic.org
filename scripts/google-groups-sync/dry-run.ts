import { createGoogleGroupsDeliveryProvider } from "../../functions/_lib/services/google-groups/directory-client";
import { reconcileMailingListDeliveries } from "../../functions/_lib/services/mailing-list-subscriptions/reconcile-delivery-lists";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { DatabaseLike, StatementLike } from "../../functions/_lib/db/types";
import type { ConfiguredGoogleServiceAccountEnv } from "../../functions/_lib/services/google-groups/contracts";
import { processGoogleGroupsSyncQueue } from "../../functions/_lib/services/google-groups/process-sync-queue";

/** SQLite enforces read-only access, including for statements executed through all()/first(). */
export function googleGroupsReadOnlyDatabase(sqlite: DatabaseSync): DatabaseLike {
  function prepare(query: string, values: SQLInputValue[] = []): StatementLike {
    const statement = sqlite.prepare(query);
    return {
      bind(...parameters) {
        return prepare(
          query,
          parameters.map((value) => {
            if (value === null || typeof value === "string" || typeof value === "number") return value;
            throw new Error("Unsupported SQL parameter");
          }),
        );
      },
      async all<T>() {
        return { results: statement.all(...values) as T[] };
      },
      async first<T>(columnName?: string) {
        const row = statement.get(...values);
        return ((columnName ? row?.[columnName] : row) as T) ?? null;
      },
      async run() {
        throw new Error("Dry run cannot execute database writes");
      },
    };
  }
  return {
    prepare,
    async batch() {
      throw new Error("Dry run cannot execute database batches");
    },
  };
}

export async function runGoogleGroupsDryRun(
  databasePath: string,
  env: ConfiguredGoogleServiceAccountEnv,
  limit: number,
) {
  const sqlite = new DatabaseSync(databasePath, { readOnly: true });
  try {
    // A stable read snapshot; never copy production records into preview.
    sqlite.exec("BEGIN");
    return await processGoogleGroupsSyncQueue(googleGroupsReadOnlyDatabase(sqlite), env, limit, { dryRun: true });
  } finally {
    sqlite.close();
  }
}

export async function runMailingListFullDryRun(databasePath: string, env: ConfiguredGoogleServiceAccountEnv) {
  const sqlite = new DatabaseSync(databasePath, { readOnly: true });
  try {
    sqlite.exec("BEGIN");
    const provider = await createGoogleGroupsDeliveryProvider(env, true);
    const report = await reconcileMailingListDeliveries(googleGroupsReadOnlyDatabase(sqlite), provider, {
      limit: Number.MAX_SAFE_INTEGER,
      dryRun: true,
    });
    const entries = report.groups.flatMap((group) => group.entries);
    return {
      scope: "full_reconciliation",
      snapshotAt: new Date().toISOString(),
      groups: report.groups,
      failed: 0,
      skippedUnconfigured: false,
      summary: Object.fromEntries(
        ["subscribe", "unsubscribe", "disable_delivery", "protected", "unchanged", "unsubscribed"].map((action) => [
          action,
          entries.filter((entry) => entry.action === action).length,
        ]),
      ),
    };
  } finally {
    sqlite.close();
  }
}
