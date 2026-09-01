import { useRef, useState } from "preact/hooks";
import type { ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge } from "../../../../ui/Badge";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput } from "../../../../ui/TextControl";
import { OperationActions } from "./OperationActions";
import { RetentionDueTable } from "./RetentionDueTable";

/** What the reminder run falls back to when the field is cleared. */
const DEFAULT_REMINDER_LIMIT = 120;

/**
 * Operational commands plus the retention domain's own pending list. The
 * outbox has its own tab backed by the email domain, and due reminders are
 * resolved by the reminder run's preview mode rather than a second read model.
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
    // The frame, padding and rhythm the `action-card` rule drew by hand are
    // the panel's own, and the "Read only" chip sits in the panel header's
    // toolbar slot rather than in a flex row above it.
    <Panel>
      <PanelHeader title="Scheduled Work">{!canRunAnything && <Badge tone="neutral">Read only</Badge>}</PanelHeader>
      <PanelBody class="pk-stack">
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
      </PanelBody>
    </Panel>
  );
}
