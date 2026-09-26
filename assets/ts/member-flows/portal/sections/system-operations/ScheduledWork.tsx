import { useRef, useState } from "preact/hooks";
import type { ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../ui/Badge";
import { Field } from "../../../../ui/Field";
import { PageHeader } from "../../../../ui/PageHeader";
import { TextInput } from "../../../../ui/TextControl";
import { OperationActions } from "./OperationActions";
import { RetentionDueTable } from "./RetentionDueTable";

/** What the reminder run falls back to when the field is cleared. */
const DEFAULT_REMINDER_LIMIT = 120;

/**
 * The work that has fallen due: the commands that run it, and retention's own
 * pending list. The outbox is its own page, backed by the email domain, and
 * due reminders are resolved by the reminder run's preview mode rather than a
 * second read model.
 */
export function ScheduledWork({
  canManageEmail,
  canRunRetention,
  canAnonymizeUsers,
  canWriteMembership,
  canApproveMembership,
}: {
  canManageEmail: boolean;
  canRunRetention: boolean;
  canAnonymizeUsers: boolean;
  canWriteMembership: boolean;
  canApproveMembership: boolean;
}) {
  const [reminderLimit, setReminderLimit] = useState(DEFAULT_REMINDER_LIMIT);
  const retentionActionsRef = useRef<ApiTableActions | null>(null);
  const canRunAnything = canManageEmail || canWriteMembership || canApproveMembership || canRunRetention;

  return (
    // Its own page under Settings, so it heads itself. Each region below is
    // its own panel: the commands (with the reminder batch size that
    // parametrizes them), then retention's pending list.
    <section aria-label="Scheduled work" class="pk pk-stack">
      <PageHeader title="Scheduled work" />
      {!canRunAnything && (
        <div class="pk-cluster pk-cluster--end">
          <Badge tone="neutral">Read only</Badge>
        </div>
      )}

      <Field label="Reminder batch size" help="How many reminders one run may send. Between 1 and 500.">
        {(control) => (
          <TextInput
            {...control}
            type="number"
            class="adm-due-work-limit"
            value={reminderLimit}
            min={1}
            max={500}
            onInput={(event) =>
              setReminderLimit(Number((event.target as HTMLInputElement).value) || DEFAULT_REMINDER_LIMIT)
            }
          />
        )}
      </Field>

      <OperationActions
        reminderLimit={reminderLimit}
        canManageEmail={canManageEmail}
        canRunRetention={canRunRetention}
        canAnonymizeUsers={canAnonymizeUsers}
        canWriteMembership={canWriteMembership}
        canApproveMembership={canApproveMembership}
        reload={() => retentionActionsRef.current?.reload() ?? Promise.resolve()}
      />

      {canRunRetention && <RetentionDueTable actionsRef={retentionActionsRef} />}

      <p class="pk-small">
        Each command runs in the domain that owns the work, and is available only to staff holding that domain&apos;s
        permission.
      </p>
    </section>
  );
}
