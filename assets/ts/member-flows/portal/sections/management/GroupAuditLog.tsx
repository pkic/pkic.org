import { AuditLogTable } from "../../../../components/AuditLogTable";

export function GroupAuditLog({ groupId }: { groupId: string }) {
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Audit log</div>
      <div class="card-body">
        <AuditLogTable
          endpoint={`/api/v1/groups/${encodeURIComponent(groupId)}/audit-log`}
          actionCell={(entry) => <code class="small">{entry.action}</code>}
          detailsCell={(entry) =>
            entry.details ? (
              <pre class="mb-0 small text-body-secondary overflow-auto">{JSON.stringify(entry.details, null, 2)}</pre>
            ) : null
          }
        />
      </div>
    </div>
  );
}
