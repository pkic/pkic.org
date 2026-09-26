import { auditLogDetailResponseSchema } from "../../../../shared/schemas/audit-log";
import { DetailsSummary } from "../../../components/DetailsSummary";
import { Spinner } from "../../../components/Spinner";
import { useData } from "../../../hooks/useData";
import { getJson } from "../../../shared/api-client";
import { Alert } from "../../../ui/Alert";
import { DescriptionList } from "../../../ui/DescriptionList";
import { PageHeader } from "../../../ui/PageHeader";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { fmt } from "../ui";

export function SystemAuditLogDetail({ id }: { id: string }) {
  const { data, error, loading } = useData(
    () => getJson(`/api/v1/audit-log/${encodeURIComponent(id)}`, auditLogDetailResponseSchema),
    [id],
  );
  const entry = data?.entry;
  return (
    <div class="pk pk-stack">
      <PageHeader
        title={entry?.action ?? "Audit log entry"}
        trail={[
          { label: "Settings", href: "#/settings" },
          { label: "Audit log", href: "#/settings/audit-log" },
          { label: entry?.action ?? "Audit log entry" },
        ]}
      />
      {loading && <Spinner />}
      {error && <Alert tone="danger">{error}</Alert>}
      {entry && (
        <>
          <Panel aria-label="Audit entry">
            <PanelBody>
              <DescriptionList
                items={[
                  { term: "When", value: fmt(entry.created_at) },
                  { term: "Actor", value: entry.actor_display ?? entry.actor_id ?? "System" },
                  { term: "Actor type", value: entry.actor_type },
                  { term: "Action", value: entry.action },
                  { term: "Entity", value: entry.entity_type },
                  { term: "Entity ID", value: entry.entity_id },
                  { term: "Entry ID", value: entry.id },
                ]}
              />
            </PanelBody>
          </Panel>
          <Panel aria-label="Recorded changes">
            <PanelHeader title="Recorded changes" />
            <PanelBody>
              {entry.details ? <DetailsSummary value={entry.details} /> : <p class="pk-muted">No changes recorded.</p>}
            </PanelBody>
          </Panel>
        </>
      )}
    </div>
  );
}
