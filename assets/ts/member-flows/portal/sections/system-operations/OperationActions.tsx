import { useState } from "preact/hooks";
import { postJson } from "../../../../shared/api-client";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { toast } from "../../ui";
import { emailReminderRunResponseSchema } from "../../../../../shared/schemas/email-reminders";
import {
  membershipBatchRunResponseSchema,
  type MembershipBatchKey,
} from "../../../../../shared/schemas/membership-batches";
import { retentionRunResponseSchema } from "../../../../../shared/schemas/retention";

type CommandKey = "preview" | "reminders" | "retention" | MembershipBatchKey;

/**
 * Each command targets the domain that owns the work, so its availability is
 * derived from that domain's permission rather than one blanket operations
 * grant.
 */
export function OperationActions({
  reminderLimit,
  canManageEmail,
  canRunRetention,
  canAnonymizeUsers,
  canWriteMembership,
  canApproveMembership,
  reload,
}: {
  reminderLimit: number;
  canManageEmail: boolean;
  canRunRetention: boolean;
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

  async function reminders(mode: "preview" | "execute"): Promise<string> {
    const result = await postJson(
      "/api/v1/email/reminders/runs",
      { mode, limit: reminderLimit },
      emailReminderRunResponseSchema,
    );
    return mode === "preview"
      ? `${result.processed} reminder candidate(s) resolved.`
      : `${result.processed} reminder action(s) queued.`;
  }

  async function runRetention(): Promise<void> {
    const confirmed = await confirmAction({
      title: "Run retention redaction for every currently eligible event and user?",
      body: "This is permanent and cannot be undone.",
      consequences: [
        "Personal data on eligible past-event registrations is permanently redacted",
        "Eligible user accounts past their retention window are permanently redacted",
        "Redacted records cannot be recovered afterward",
      ],
      confirmLabel: "Run retention redaction",
      typedConfirmation: "REDACT",
    });
    if (!confirmed) return;
    await run("retention", async () => {
      const result = await postJson("/api/v1/retention/runs", { mode: "execute" }, retentionRunResponseSchema);
      return `Redacted ${result.redactedRegistrations} registration(s) and ${result.redactedUsers} user(s).`;
    });
  }

  async function membershipBatch(batchKey: MembershipBatchKey): Promise<string> {
    const result = await postJson(`/api/v1/membership/batches/${batchKey}/runs`, {}, membershipBatchRunResponseSchema);
    if (batchKey === "consultation") return `${result.applicationsNotified ?? 0} consultation application(s) notified.`;
    if (batchKey === "ec-review") return `${result.transitioned ?? 0} application(s) moved to EC review.`;
    return `${result.emailsSent ?? 0} chair digest email(s) queued.`;
  }

  const canRunAnything = canManageEmail || canWriteMembership || canApproveMembership || canRunRetention;

  return (
    <div class="border rounded p-3 mb-3" aria-label="Operational commands">
      <div class="d-flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          disabled={busy !== null}
          onClick={() => void run("preview", () => reminders("preview"))}
        >
          Preview reminders
        </button>
        {canManageEmail && (
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            disabled={busy !== null}
            onClick={() => void run("reminders", () => reminders("execute"))}
          >
            Queue reminders
          </button>
        )}
        {canWriteMembership && (
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            disabled={busy !== null}
            onClick={() => void run("consultation", () => membershipBatch("consultation"))}
          >
            Run consultation batch
          </button>
        )}
        {canApproveMembership && (
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            disabled={busy !== null}
            onClick={() => void run("ec-review", () => membershipBatch("ec-review"))}
          >
            Run EC review batch
          </button>
        )}
        {canWriteMembership && (
          <button
            type="button"
            class="btn btn-sm btn-outline-primary"
            disabled={busy !== null}
            onClick={() => void run("wg-chair-digest", () => membershipBatch("wg-chair-digest"))}
          >
            Queue chair digest
          </button>
        )}
        {canRunRetention && canAnonymizeUsers && (
          <button
            type="button"
            class="btn btn-sm btn-outline-danger"
            disabled={busy !== null}
            onClick={() => void runRetention()}
          >
            Run retention redaction
          </button>
        )}
      </div>
      {!canRunAnything && <p class="small text-muted mb-0 mt-2">Reminder preview is read-only.</p>}
    </div>
  );
}
