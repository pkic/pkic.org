/**
 * A template's versions, newest first, with each row's commands behind its
 * own menu.
 *
 * The row used to carry an "Activate" button, a "Load" button and, on the
 * version in use, an "In use" badge beside a Status column that already said
 * "Active" — two words for one fact and a row of buttons the rest of the
 * portal keeps in a `…` menu (#98).
 */
import { statusLabel } from "../../../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { Badge, type BadgeTone } from "../../../../ui/Badge";
import type { MenuItem } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { formatDateTime } from "../../../../shared/ui";
import {
  emailTemplateVersionsListResponseSchema,
  type EmailTemplateVersion,
} from "../../../../../shared/schemas/email-templates";
import { EMAIL_TEMPLATES_API } from "../../../../shared/email-template-catalog";
import type { RefObject } from "preact";

/** Only the version actually in use carries a tone; a draft is not a status. */
function versionTone(status: string): BadgeTone {
  return status === "active" ? "ok" : "neutral";
}

export function EmailTemplateVersionHistory({
  templateKey,
  canWrite,
  historyRef,
  onLoad,
  onActivate,
}: {
  templateKey: string;
  canWrite: boolean;
  historyRef: RefObject<ApiTableActions | null>;
  onLoad: (version: EmailTemplateVersion) => void;
  onActivate: (version: number) => void | Promise<void>;
}) {
  function rowActions(version: EmailTemplateVersion): MenuItem[] {
    return [
      ...(canWrite && version.status !== "active"
        ? [{ id: "activate", label: "Activate", onSelect: () => void onActivate(version.version) }]
        : []),
      { id: "load", label: "Load into editor", onSelect: () => onLoad(version) },
    ];
  }

  return (
    <Panel>
      <PanelHeader title="Version History" />
      <PanelBody>
        <ApiDataTable
          caption="Email template versions"
          endpoint={`${EMAIL_TEMPLATES_API}/${encodeURIComponent(templateKey)}/versions`}
          responseSchema={emailTemplateVersionsListResponseSchema}
          resolve={(response) => response.versions}
          resolvePage={(response) => response.page}
          paginate
          initialPageSize={25}
          initialSort="-version"
          actionsRef={historyRef}
          columns={[
            { header: "Version", cell: (v) => <code>v{v.version}</code> },
            {
              header: "Status",
              cell: (v) => <Badge tone={versionTone(v.status)}>{statusLabel(v.status)}</Badge>,
              width: "fit",
            },
            {
              header: "Type",
              cell: (v) => (v.message_type ? <Badge tone="neutral">{statusLabel(v.message_type)}</Badge> : "—"),
              width: "fit",
            },
            {
              header: "Sender",
              cell: (v) =>
                v.from_email ? (
                  <span class="pk-small">{v.from_name ? `${v.from_name} <${v.from_email}>` : v.from_email}</span>
                ) : (
                  <span class="pk-small pk-muted">Configured sender</span>
                ),
            },
            {
              header: "Checksum",
              cell: (v) => <code>{v.checksum_sha256.substring(0, 12)}…</code>,
              className: "pk-small",
              width: "fit",
            },
            {
              header: "Created",
              cell: (v) => formatDateTime(v.created_at),
              className: "pk-small",
              width: "fit",
            },
            {
              header: "Actions",
              className: "pk-end",
              width: "fit",
              cell: (v) => <RowActions subject={`v${v.version}`} actions={rowActions(v)} />,
            },
          ]}
          empty="No versions yet"
          rowKey={(v) => v.id}
        />
      </PanelBody>
    </Panel>
  );
}
