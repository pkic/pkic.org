/**
 * The email domains an organization is reached through: a view of its own
 * under the record, opened from the record's "…" menu like the merge.
 *
 * It answers one question — "which addresses lead people here, and how many
 * came that way" — so it is the shared server list with one row per domain.
 * Claiming a domain is a form of its own (OrganizationDomainClaimForm), and
 * removing a claim is the row's command, confirmed first.
 */
import { useRef } from "preact/hooks";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import {
  organizationDomainsListResponseSchema,
  type OrganizationDomain,
  type OrganizationDomainStatus,
} from "../../../../../shared/schemas/organization-domains";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { formatNumber } from "../../../../../shared/format-number";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import type { Column } from "../../../../components/Table";
import { ApiClientError, deleteJson } from "../../../../shared/api-client";
import { Badge, type BadgeTone } from "../../../../ui/Badge";
import { EmptyState } from "../../../../ui/EmptyState";
import { RowActions } from "../../../../ui/RowActions";
import { usePortalHashLocation } from "../../hash-location";
import { fmtDate, toast } from "../../ui";
import { SectionHeading } from "../../../../ui/SectionHeading";
import { OrganizationRecordHero } from "./OrganizationRecordHero";
import { OrganizationRecordTrail, organizationRecordHref, useOrganizationRecord } from "./OrganizationRecordTrail";

const STATUS: Record<OrganizationDomainStatus, { label: string; tone: BadgeTone }> = {
  claimed: { label: "Claimed", tone: "ok" },
  derived: { label: "Through people", tone: "info" },
  held: { label: "Held by an application", tone: "warn" },
};

function DomainsTable({ organization, canWrite }: { organization: OrganizationDetail; canWrite: boolean }) {
  const [, navigate] = usePortalHashLocation();
  const endpoint = `/api/v1/organizations/${encodeURIComponent(organization.id)}/domains`;
  const actionsRef = useRef<ApiTableActions | null>(null);

  async function release(domain: OrganizationDomain): Promise<void> {
    const confirmed = await confirmAction({
      title: `Remove the claim on @${domain.domain}?`,
      body: "People already linked keep their relationship with the organization.",
      consequences: [`New @${domain.domain} addresses no longer join ${organization.name} through the claim`],
      confirmLabel: "Remove claim",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteJson(`${endpoint}/${encodeURIComponent(domain.domain)}`, successResponseSchema);
      toast(`@${domain.domain} is no longer claimed`, "success");
      await actionsRef.current?.reload();
    } catch (caught) {
      toast(caught instanceof ApiClientError ? caught.message : "Could not remove the claim.", "error");
    }
  }

  const columns: Column<OrganizationDomain>[] = [
    {
      header: "Domain",
      cell: (domain) => <strong>@{domain.domain}</strong>,
      sort: { asc: "domain", desc: "-domain", defaultDirection: "asc" },
    },
    {
      header: "Source",
      cell: (domain) => <Badge tone={STATUS[domain.status].tone}>{STATUS[domain.status].label}</Badge>,
      width: "fit",
    },
    {
      header: "People linked",
      cell: (domain) => formatNumber(domain.people),
      sort: { asc: "people", desc: "-people", defaultDirection: "desc" },
      align: "end",
      width: "fit",
    },
    {
      header: "Claimed",
      cell: (domain) => (domain.claimedAt ? fmtDate(domain.claimedAt) : <span class="pk-muted">—</span>),
      width: "fit",
    },
    ...(canWrite
      ? [
          {
            header: "Actions",
            cell: (domain: OrganizationDomain) =>
              domain.status === "claimed" ? (
                <RowActions
                  subject={`@${domain.domain}`}
                  actions={[{ id: "release", label: "Remove claim", onSelect: () => void release(domain) }]}
                />
              ) : null,
            width: "fit" as const,
          },
        ]
      : []),
  ];

  return (
    <ApiDataTable
      urlState="organization-domains"
      caption={`Email domains of ${organization.name}`}
      endpoint={endpoint}
      responseSchema={organizationDomainsListResponseSchema}
      resolve={(data) => data.domains}
      resolvePage={(data) => data.page}
      paginate
      searchPlaceholder="Search domains…"
      actionsRef={actionsRef}
      createAction={
        canWrite && !organization.mergedInto
          ? {
              label: "Claim a domain",
              onSelect: () => navigate(organizationRecordHref(organization.id, "/domains/new")),
            }
          : undefined
      }
      columns={columns}
      empty={
        <EmptyState
          title="No email domains"
          body={`Nobody joined ${organization.name} through a work address yet, and it claims no domain.`}
        />
      }
      rowKey={(domain) => domain.domain}
    />
  );
}

export function OrganizationDomains({ organizationId, canWrite }: { organizationId: string; canWrite: boolean }) {
  const loaded = useOrganizationRecord(organizationId);
  const organization = loaded.data;
  return (
    <section class="pk pk-stack" aria-label="Email domains">
      <OrganizationRecordTrail organization={organization} here="Email domains" />
      <ErrorAlert error={loaded.error} />
      {!organization ? (
        !loaded.error && <Spinner />
      ) : (
        <>
          <OrganizationRecordHero organization={organization} />
          <SectionHeading level={3}>Email domains</SectionHeading>
          <p class="pk-muted pk-small">
            {`People with a verified address on a claimed domain join ${organization.name}. Free and disposable mail never does.`}
          </p>
          <DomainsTable organization={organization} canWrite={canWrite} />
        </>
      )}
    </section>
  );
}
