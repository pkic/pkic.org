import { useRef, useState } from "preact/hooks";
import type { ApiTableActions } from "../../../../components/ApiDataTable";
import { DueWorkTable } from "./DueWorkTable";
import { OperationActions } from "./OperationActions";

export function DueWork({
  canRun,
  canAnonymizeUsers,
  canWriteMembership,
  canApproveMembership,
}: {
  canRun: boolean;
  canAnonymizeUsers: boolean;
  canWriteMembership: boolean;
  canApproveMembership: boolean;
}) {
  const [reminderLimit, setReminderLimit] = useState(120);
  const [outboxLimit, setOutboxLimit] = useState(120);
  const [includeRetention, setIncludeRetention] = useState(false);
  const dueWorkActionsRef = useRef<ApiTableActions | null>(null);

  return (
    <div>
      <div class="action-card">
        <div class="d-flex flex-wrap justify-content-between gap-2 align-items-center mb-3">
          <strong>Due Work</strong>
          {!canRun && <span class="badge text-bg-light border text-dark">Read only</span>}
        </div>

        <div class="border rounded p-2 mb-3 bg-light-subtle">
          <div class="d-flex flex-wrap align-items-center gap-3 small">
            <label class="d-inline-flex align-items-center gap-2 mb-0">
              <span class="text-muted">Reminders</span>
              <input
                type="number"
                class="form-control form-control-sm adm-due-work-limit"
                value={reminderLimit}
                min={1}
                max={500}
                onInput={(event) => setReminderLimit(Number((event.target as HTMLInputElement).value) || 120)}
              />
            </label>
            <label class="d-inline-flex align-items-center gap-2 mb-0">
              <span class="text-muted">Outbox</span>
              <input
                type="number"
                class="form-control form-control-sm adm-due-work-limit"
                value={outboxLimit}
                min={1}
                max={500}
                onInput={(event) => setOutboxLimit(Number((event.target as HTMLInputElement).value) || 120)}
              />
            </label>
            <label class="d-inline-flex align-items-center gap-2 mb-0">
              <input
                class="form-check-input mt-0"
                type="checkbox"
                checked={includeRetention}
                onChange={(event) => setIncludeRetention((event.target as HTMLInputElement).checked)}
              />
              <span class="text-muted">Cleanup</span>
            </label>
          </div>
        </div>

        <OperationActions
          reminderLimit={reminderLimit}
          canRun={canRun}
          canAnonymizeUsers={canAnonymizeUsers}
          canWriteMembership={canWriteMembership}
          canApproveMembership={canApproveMembership}
          reload={() => dueWorkActionsRef.current?.reload() ?? Promise.resolve()}
        />

        <DueWorkTable
          reminderLimit={reminderLimit}
          outboxLimit={outboxLimit}
          includeRetention={includeRetention}
          actionsRef={dueWorkActionsRef}
        />

        <p class="small text-muted mt-3 mb-0">
          The queue table is a bounded operational preview. Run controls are available only to staff with the relevant
          operation permissions.
        </p>
      </div>
    </div>
  );
}
