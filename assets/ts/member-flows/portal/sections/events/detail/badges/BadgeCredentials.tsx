import { useState } from "preact/hooks";
import {
  badgeCredentialMetadataSchema,
  badgeCredentialsResponseSchema,
  badgeCredentialStatusSchema,
} from "../../../../../../../shared/schemas/route-contracts-event-badges";
import { databaseIdSchema } from "../../../../../../../shared/schemas/identifiers";
import { successResponseSchema } from "../../../../../../../shared/schemas/api-common";
import { formatDateTime } from "../../../../../../../shared/format-date";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Badge } from "../../../../../../components/Badge";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { useData } from "../../../../../../hooks/useData";
import { deleteJson, getJson } from "../../../../../../shared/api-client";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { Menu } from "../../../../../../ui/Menu";
import { EmptyState } from "../../../../../../ui/RecordEmptyState";
import { usePortalHashLocation } from "../../../../hash-location";
import { BadgeIssuance } from "../scanner/BadgeIssuance";

export function BadgeCredentials({
  slug,
  basePath,
  credentialId,
  segment,
  userId,
}: {
  slug: string;
  basePath: string;
  credentialId?: string;
  segment?: string;
  /** Optional canonical user scope; filtering remains a bounded server query. */
  userId?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const requestedUser = databaseIdSchema.safeParse(
    new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("userId"),
  );
  const scopedUserId = userId ?? (requestedUser.success ? requestedUser.data : undefined);
  const scopeQuery = scopedUserId ? `?userId=${encodeURIComponent(scopedUserId)}` : "";
  const recordPath = (id: string) => `${basePath}/${encodeURIComponent(id)}`;
  if (credentialId === "new")
    return (
      <BadgeIssuance
        key={`new:${scopedUserId ?? "any"}`}
        slug={slug}
        userId={scopedUserId}
        onBack={() => navigate(`${basePath}${scopeQuery}`)}
        onRecord={(id) => navigate(recordPath(id))}
      />
    );
  if (credentialId)
    return (
      <BadgeCredentialRecord
        key={credentialId}
        slug={slug}
        credentialId={credentialId}
        replacing={segment === "replace"}
        basePath={basePath}
      />
    );
  return (
    <ApiDataTable
      caption="Badge credentials"
      endpoint={`/api/v1/events/${encodeURIComponent(slug)}/badges`}
      responseSchema={badgeCredentialsResponseSchema}
      resolve={(data) => data.badges}
      resolvePage={(data) => data.page}
      params={scopedUserId ? { userId: scopedUserId } : undefined}
      urlState="badges"
      paginate
      initialSort="-createdAt"
      searchPlaceholder="name or credential reference"
      createAction={{ label: "Create badge", onSelect: () => navigate(`${basePath}/new${scopeQuery}`) }}
      rowKey={(badge) => badge.id}
      columns={[
        {
          header: "Attendee",
          width: "primary",
          sort: { asc: "displayName", desc: "-displayName" },
          cell: (badge) => (
            <a href={usePortalHashLocation.hrefs(recordPath(badge.id))}>
              {badge.displayName ?? "Attendee name unavailable"}
            </a>
          ),
        },
        {
          header: "Status",
          width: "fit",
          cell: (badge) => <Badge status={badge.status} />,
          filter: {
            param: "status",
            options: [
              { value: "", label: "All statuses" },
              ...badgeCredentialStatusSchema.options.map((status) => ({
                value: status,
                label: status[0].toUpperCase() + status.slice(1),
              })),
            ],
          },
        },
        {
          header: "Issued",
          width: "fit",
          sort: { asc: "createdAt", desc: "-createdAt" },
          cell: (badge) => formatDateTime(badge.createdAt),
        },
        {
          header: "Expires",
          width: "fit",
          sort: { asc: "expiresAt", desc: "-expiresAt" },
          cell: (badge) => formatDateTime(badge.expiresAt),
        },
      ]}
      empty={<EmptyState title="No badge credentials" body="Create a badge for a registered attendee." />}
    />
  );
}

/** Reloadable metadata record. A selected row never grants a bearer read. */
function BadgeCredentialRecord({
  slug,
  credentialId,
  replacing,
  basePath,
}: {
  slug: string;
  credentialId: string;
  replacing: boolean;
  basePath: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/badges/${encodeURIComponent(credentialId)}`;
  const record = useData(() => getJson(endpoint, badgeCredentialMetadataSchema), [endpoint]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const path = `${basePath}/${encodeURIComponent(credentialId)}`;
  async function revoke() {
    if (
      !(await confirmAction({
        title: "Revoke this badge credential?",
        body: "Only this credential will stop working. Other credentials for this attendee remain valid.",
        confirmLabel: "Revoke credential",
        tone: "danger",
      }))
    )
      return;
    setBusy(true);
    setError("");
    try {
      await deleteJson(endpoint, successResponseSchema);
      await record.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke badge.");
    } finally {
      setBusy(false);
    }
  }
  if (record.loading) return <Spinner label="Loading badge credential…" />;
  if (!record.data) return <ErrorAlert error={record.error ?? "Badge credential unavailable."} />;
  const badge = record.data;
  if (replacing && badge.status !== "revoked")
    return (
      <BadgeIssuance
        key={`replace:${badge.id}`}
        slug={slug}
        replacement={badge}
        onBack={() => navigate(path)}
        onRecord={(id) => navigate(`${basePath}/${encodeURIComponent(id)}`)}
      />
    );
  return (
    <div class="pk-stack">
      <PageHeader
        title="Badge credential"
        description={badge.displayName ?? "Attendee name unavailable"}
        context={<Badge status={badge.status} />}
        actions={
          <Menu
            label="Record actions"
            items={[
              {
                id: "replace",
                label: "Replace credential",
                disabled: busy || badge.status === "revoked",
                onSelect: () => navigate(`${path}/replace`),
              },
              {
                id: "revoke",
                label: "Revoke credential",
                danger: true,
                disabled: busy || badge.status === "revoked",
                onSelect: () => void revoke(),
              },
              { id: "back", label: "Back to badges", onSelect: () => navigate(basePath) },
            ]}
          />
        }
      />
      <DescriptionList
        items={[
          { term: "Attendee", value: badge.displayName ?? "Attendee name unavailable" },
          { term: "Credential reference", value: badge.id },
          { term: "Issued", value: formatDateTime(badge.createdAt) },
          { term: "Valid until", value: formatDateTime(badge.expiresAt) },
          { term: "Revoked", value: formatDateTime(badge.revokedAt) },
        ]}
      />
      <p>
        This record stores a credential reference, not its QR code. Reprint a saved HTML or SVG file from issuance, or
        explicitly replace this selected credential to create a new code. Replacement revokes only this code.
      </p>
      {(error || record.error) && <ErrorAlert error={error || record.error} />}
    </div>
  );
}
