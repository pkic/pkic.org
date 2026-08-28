import { useState } from "preact/hooks";
import { postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import {
  operationsMembershipBatchResponseSchema,
  operationsRemindersRunResponseSchema,
  operationsRetentionRunResponseSchema,
} from "../../../../../shared/schemas/operations";

type CommandKey = "preview" | "reminders" | "retention" | "consultation" | "ec-review" | "wg-chair-digest";

export function OperationActions({
  reminderLimit,
  canRun,
  canAnonymizeUsers,
  canWriteMembership,
  canApproveMembership,
  reload,
}: {
  reminderLimit: number;
  canRun: boolean;
  canAnonymizeUsers: boolean;
  canWriteMembership: boolean;
  canApproveMembership: boolean;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<CommandKey | null>(null);

  async function run(key: CommandKey, action: () => Promise<string>): Promise<void> {
    setBusy(key);
    try {
      toast(await action(), "success");
      await reload();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(null);
    }
  }

  async function reminders(preview: boolean): Promise<string> {
    const result = await postJson(
      preview ? "/api/v1/operations/reminders/preview" : "/api/v1/operations/reminders/run",
      { limit: reminderLimit },
      operationsRemindersRunResponseSchema,
    );
    return preview
      ? `${result.processed} reminder candidate(s) in the bounded preview.`
      : `${result.processed} reminder action(s) queued.`;
  }

  async function membershipBatch(kind: "consultation" | "ec-review" | "wg-chair-digest"): Promise<string> {
    const result = await postJson(
      `/api/v1/operations/membership-batches/${kind}/run`,
      {},
      operationsMembershipBatchResponseSchema,
    );
    if (kind === "consultation") return `${result.applicationsNotified ?? 0} consultation application(s) notified.`;
    if (kind === "ec-review") return `${result.transitioned ?? 0} application(s) moved to EC review.`;
    return `${result.emailsSent ?? 0} chair digest email(s) queued.`;
  }

  return (
    <div class="border rounded p-3 mb-3" aria-label="Due work commands">
      <div class="d-flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          disabled={busy !== null}
          onClick={() => void run("preview", () => reminders(true))}
        >
          Preview reminders
        </button>
        {canRun && (
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            disabled={busy !== null}
            onClick={() => void run("reminders", () => reminders(false))}
          >
            Queue reminders
          </button>
        )}
        {canRun && canWriteMembership && (
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            disabled={busy !== null}
            onClick={() => void run("consultation", () => membershipBatch("consultation"))}
          >
            Run consultation batch
          </button>
        )}
        {canRun && canApproveMembership && (
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            disabled={busy !== null}
            onClick={() => void run("ec-review", () => membershipBatch("ec-review"))}
          >
            Run EC review batch
          </button>
        )}
        {canRun && (
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            disabled={busy !== null}
            onClick={() => void run("wg-chair-digest", () => membershipBatch("wg-chair-digest"))}
          >
            Queue chair digest
          </button>
        )}
        {canRun && canAnonymizeUsers && (
          <button
            type="button"
            class="btn btn-sm btn-outline-danger"
            disabled={busy !== null}
            onClick={() => {
              if (!window.confirm("Run retention redaction for every currently eligible event and user?")) return;
              void run("retention", async () => {
                const result = await postJson(
                  "/api/v1/operations/retention/run",
                  {},
                  operationsRetentionRunResponseSchema,
                );
                return `Redacted ${result.redactedRegistrations} registration(s) and ${result.redactedUsers} user(s).`;
              });
            }}
          >
            Run retention redaction
          </button>
        )}
      </div>
      {!canRun && <p class="small text-muted mb-0 mt-2">Reminder preview is read-only.</p>}
    </div>
  );
}
