import { useState } from "preact/hooks";
import { postJson } from "../../../../shared/api-client";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { Button, type ButtonVariant } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
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

  /**
   * The commands, as data. Six near-identical button blocks differed only in
   * their label, their permission and the call they made, which is three
   * facts per command and sixty lines of markup to carry them.
   */
  const commands: ReadonlyArray<{
    key: CommandKey;
    label: string;
    variant: ButtonVariant;
    visible: boolean;
    activate: () => void;
  }> = [
    {
      key: "preview",
      label: "Preview reminders",
      variant: "secondary",
      visible: true,
      activate: () => void run("preview", () => reminders("preview")),
    },
    {
      key: "reminders",
      label: "Queue reminders",
      variant: "primary",
      visible: canManageEmail,
      activate: () => void run("reminders", () => reminders("execute")),
    },
    {
      key: "consultation",
      label: "Run consultation batch",
      variant: "primary",
      visible: canWriteMembership,
      activate: () => void run("consultation", () => membershipBatch("consultation")),
    },
    {
      key: "ec-review",
      label: "Run EC review batch",
      variant: "primary",
      visible: canApproveMembership,
      activate: () => void run("ec-review", () => membershipBatch("ec-review")),
    },
    {
      key: "wg-chair-digest",
      label: "Queue chair digest",
      variant: "primary",
      visible: canWriteMembership,
      activate: () => void run("wg-chair-digest", () => membershipBatch("wg-chair-digest")),
    },
    {
      key: "retention",
      label: "Run retention redaction",
      variant: "danger-quiet",
      visible: canRunRetention && canAnonymizeUsers,
      activate: () => void runRetention(),
    },
  ];

  return (
    // `aria-label` on a bare `<div>` names nothing — a div has no role for the
    // name to attach to — so the group of commands was announced as unlabeled
    // content. A named panel is a region with a heading, which is what a bar
    // of irreversible operations should be.
    <div class="pk">
      <Panel aria-label="Operational commands">
        <PanelHeader title="Operational commands" headingLevel={4} />
        <PanelBody class="pk-stack pk-stack--snug">
          <div class="pk-cluster">
            {commands
              .filter((command) => command.visible)
              .map((command) => (
                // `loading` keeps the running command focusable and says it is
                // busy, rather than disabling it and throwing a keyboard user
                // out of the bar they were in.
                <Button
                  key={command.key}
                  size="sm"
                  variant={command.variant}
                  loading={busy === command.key}
                  disabled={busy !== null}
                  onClick={command.activate}
                >
                  {command.label}
                </Button>
              ))}
          </div>
          {!canRunAnything && <p class="pk-small">Reminder preview is read-only.</p>}
        </PanelBody>
      </Panel>
    </div>
  );
}
