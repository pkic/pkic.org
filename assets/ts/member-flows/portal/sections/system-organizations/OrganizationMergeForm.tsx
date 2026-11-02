/**
 * Merging a duplicate organization into the one that stays: a page of its
 * own under the duplicate's record, opened from the record's "…" menu, like
 * adding an identity under a person's record. The way back is the record.
 */
import { useState } from "preact/hooks";
import type { OrganizationDetail, OrganizationSummary } from "../../../../../shared/schemas/organization-management";
import {
  organizationMergeRequestSchema,
  organizationMergeResponseSchema,
} from "../../../../../shared/schemas/organization-merge";
import { formatNumber } from "../../../../../shared/format-number";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ServerSearchSelect } from "../../../../components/ServerSearchSelect";
import { Spinner } from "../../../../components/Spinner";
import { useContractForm } from "../../../../hooks/useContractForm";
import { postJson } from "../../../../shared/api-client";
import { adminOrganizationCatalog } from "../../../../shared/management-catalogs";
import { Alert } from "../../../../ui/Alert";
import { Button, ButtonLink } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { usePortalHashLocation } from "../../hash-location";
import { toast } from "../../ui";
import { OrganizationRecordHero } from "./OrganizationRecordHero";
import { OrganizationRecordTrail, organizationRecordHref, useOrganizationRecord } from "./OrganizationRecordTrail";

function peopleCount(count: number): string {
  return `${formatNumber(count)} ${count === 1 ? "person" : "people"}`;
}

/** What the merge carries over, stated before staff confirm it. */
export function organizationMergeConsequences(source: OrganizationDetail, target: OrganizationSummary): string[] {
  const consequences = [
    `${peopleCount(source.activeIdentityCount)} who represent ${source.name} will represent ${target.name}`,
    `${source.name} leaves the directory; its page and credits lead to ${target.name}`,
  ];
  if (source.claimedDomains.length > 0)
    consequences.push(
      `${source.claimedDomains.map((domain) => `@${domain}`).join(", ")} addresses will join ${target.name}`,
    );
  return consequences;
}

function MergeForm({ source }: { source: OrganizationDetail }) {
  const [, navigate] = usePortalHashLocation();
  const [target, setTarget] = useState<OrganizationSummary | null>(null);
  const [endSourceMembership, setEndSourceMembership] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(organizationMergeRequestSchema, {
    organizationId: target?.id ?? "",
    sourceOrganizationId: source.id,
    endSourceMembership,
  });
  const bothMembers = Boolean(source.membershipCategory && target?.membershipCategory);
  const recordHref = organizationRecordHref(source.id);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    if (!target) return;
    const confirmed = await confirmAction({
      title: `Merge ${source.name} into ${target.name}?`,
      body: "This cannot be undone from the portal.",
      consequences: [
        ...organizationMergeConsequences(source, target),
        ...(checked.data.endSourceMembership ? [`${source.name}’s membership ends`] : []),
      ],
      confirmLabel: "Merge",
      cancelLabel: "Keep both",
    });
    if (!confirmed) return;
    setSaving(true);
    try {
      const { organizationId, ...body } = checked.data;
      await postJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/merges`,
        body,
        organizationMergeResponseSchema,
      );
      toast(`${source.name} merged into ${target.name}`, "success");
      navigate(organizationRecordHref(organizationId));
    } catch (caught) {
      const message = form.refuse(caught);
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel aria-label="Merge into another organization">
      <PanelHeader title="Merge into another organization" />
      <PanelBody>
        <form noValidate class="pk-stack pk-stack--snug" {...form.handlers} onSubmit={(event) => void submit(event)}>
          <Field
            label="Organization that stays"
            help={`Everything ${source.name} holds moves there: its representatives, email domains and sponsorships.`}
            {...form.of("organizationId")}
          >
            {(control) => (
              <ServerSearchSelect
                {...control}
                catalog={adminOrganizationCatalog}
                searchLabel="Organization that stays"
                value={target?.id ?? null}
                selectedLabel={target?.name}
                placeholder="Search organizations…"
                allowEmpty
                onChange={setTarget}
              />
            )}
          </Field>
          {bothMembers && (
            <Checkbox
              id="organization-merge-end-membership"
              checked={endSourceMembership}
              onChange={(event) => setEndSourceMembership(event.currentTarget.checked)}
              label={`End ${source.name}’s membership`}
              hint={`Both organizations are members; only ${target?.name ?? "the organization that stays"} keeps its membership.`}
            />
          )}
          {error && <Alert tone="danger">{error}</Alert>}
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={saving}>
              Merge
            </Button>
            <ButtonLink variant="ghost" href={usePortalHashLocation.hrefs(recordHref)}>
              Cancel
            </ButtonLink>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}

export function OrganizationMergeForm({ organizationId }: { organizationId: string }) {
  const loaded = useOrganizationRecord(organizationId);
  const source = loaded.data;
  return (
    <section class="pk pk-stack" aria-label="Merge organization">
      <OrganizationRecordTrail organization={source} here="Merge" />
      <ErrorAlert error={loaded.error} />
      {!source ? (
        !loaded.error && <Spinner />
      ) : (
        <>
          <OrganizationRecordHero organization={source} />
          <MergeForm source={source} />
        </>
      )}
    </section>
  );
}
