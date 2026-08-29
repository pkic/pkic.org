import { useRef, useState } from "preact/hooks";
import type { ApiTableActions } from "../../../../components/ApiDataTable";
import { OperationActions } from "./OperationActions";
import { RetentionDueTable } from "./RetentionDueTable";

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
  const [reminderLimit, setReminderLimit] = useState(120);
  const retentionActionsRef = useRef<ApiTableActions | null>(null);
  const canRunAnything = canManageEmail || canWriteMembership || canApproveMembership || canRunRetention;

  return (
    <div>
      <div class="action-card">
        <div class="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-3">
          <strong>Scheduled Work</strong>
          {!canRunAnything && <span class="badge text-bg-light border text-dark">Read only</span>}
        </div>

        <div class="border rounded p-2 mb-3 bg-light-subtle">
          <label class="d-inline-flex align-items-center gap-2 mb-0 small">
            <span class="text-muted">Reminder batch size</span>
            <input
              type="number"
              class="form-control form-control-sm adm-due-work-limit"
              value={reminderLimit}
              min={1}
              max={500}
              onInput={(event) => setReminderLimit(Number((event.target as HTMLInputElement).value) || 120)}
            />
          </label>
        </div>

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

        <p class="small text-muted mt-3 mb-0">
          Each command runs in the domain that owns the work, and is available only to staff holding that domain&apos;s
          permission.
        </p>
      </div>
    </div>
  );
}
