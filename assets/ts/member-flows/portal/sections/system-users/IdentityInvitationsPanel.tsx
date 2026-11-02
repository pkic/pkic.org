import type { z } from "zod";
/** Pending invitations are read live; a login-time count must not hide new invitations. */
import { useState } from "preact/hooks";
import {
  identitiesListResponseSchema,
  identityMutationResponseSchema,
  currentUserIdentityUpdateSchema,
  type ActingIdentity,
} from "../../../../../shared/schemas/identity";
import { ApiDataTable } from "../../../../components/ApiDataTable";
import type { Column } from "../../../../components/Table";
import { patchJson } from "../../../../shared/api-client";
import { RowActions } from "../../../../ui/RowActions";
import { Panel, PanelHeader } from "../../../../ui/Panel";
import { toast } from "../../ui";

export function IdentityInvitationsPanel() {
  const [empty, setEmpty] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  async function accept(identity: ActingIdentity): Promise<void> {
    setAccepting(identity.id);
    try {
      await patchJson(
        `/api/v1/users/current/identities/${encodeURIComponent(identity.id)}`,
        currentUserIdentityUpdateSchema.parse({ transition: { state: "active" } }),
        identityMutationResponseSchema,
      );
      toast(`Identity for ${identity.organizationName ?? "the organization"} accepted`, "success");
      window.location.reload();
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Could not accept the identity invitation.", "error");
    } finally {
      setAccepting(null);
    }
  }
  const columns: Column<ActingIdentity>[] = [
    { header: "Organization", width: "primary", cell: (identity) => identity.organizationName },
    { header: "Job title", cell: (identity) => identity.jobTitle },
    { header: "Email", cell: (identity) => identity.email },
    {
      header: "",
      width: "fit",
      cell: (identity) => (
        <RowActions
          subject={identity.organizationName ?? identity.email}
          actions={[
            {
              id: "accept",
              label: accepting === identity.id ? "Accepting…" : "Accept identity",
              disabled: accepting !== null,
              onSelect: () => void accept(identity),
            },
          ]}
        />
      ),
    },
  ];
  return (
    <div hidden={empty}>
      <Panel aria-label="Identity invitations">
        <PanelHeader title="Identity invitations" headingLevel={2} />
        <ApiDataTable<ActingIdentity, z.infer<typeof identitiesListResponseSchema>>
          urlState="identity-invitations"
          caption="Identity invitations"
          endpoint="/api/v1/users/current/identities"
          params={{ state: "pending", organizationOnly: "true" }}
          responseSchema={identitiesListResponseSchema}
          resolve={(data) => data.identities}
          resolvePage={(data) => data.page}
          onData={(data) => setEmpty(data.page.total === 0)}
          columns={columns}
          rowKey={(identity) => identity.id}
          paginate
          searchPlaceholder=""
          empty="No identity invitations are waiting for acceptance."
        />
      </Panel>
    </div>
  );
}
