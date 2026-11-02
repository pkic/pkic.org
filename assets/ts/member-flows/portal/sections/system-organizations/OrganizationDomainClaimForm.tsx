/**
 * Claiming an email domain for an organization: a form of its own under the
 * record's domains, validated by the claim contract the route parses.
 *
 * Before the claim is saved, staff see how many people who already verified
 * an address on the domain it reaches, and confirm. A domain another
 * organization already claims means the two records are one organization;
 * the refusal names it, and the form offers that record's merge instead.
 */
import { useState } from "preact/hooks";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import {
  organizationDomainClaimPreviewResponseSchema,
  organizationDomainClaimRequestSchema,
  organizationDomainClaimResponseSchema,
  type OrganizationDomainClaimPreview,
  organizationDomainClaimedElsewhereDetailsSchema,
} from "../../../../../shared/schemas/organization-domains";
import { formatNumber } from "../../../../../shared/format-number";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useContractForm } from "../../../../hooks/useContractForm";
import { ApiClientError, getJson, postJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { Button, ButtonLink } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput, Textarea } from "../../../../ui/TextControl";
import { usePortalHashLocation } from "../../hash-location";
import { toast } from "../../ui";
import { OrganizationRecordHero } from "./OrganizationRecordHero";
import { OrganizationRecordTrail, organizationRecordHref, useOrganizationRecord } from "./OrganizationRecordTrail";

/** Who the claim reaches: people already verified on the domain join. */
export function domainClaimReach(preview: OrganizationDomainClaimPreview, organizationName: string): string {
  const people = `${formatNumber(preview.peopleToLink)} ${preview.peopleToLink === 1 ? "person" : "people"}`;
  return `${people} with a verified address on @${preview.domain} will be linked to ${organizationName}`;
}

/** The organization a refused claim names, when the domain is claimed elsewhere. */
function claimedElsewhere(error: unknown) {
  if (!(error instanceof ApiClientError) || error.code !== "ORGANIZATION_DOMAIN_CLAIMED_ELSEWHERE") return null;
  const parsed = organizationDomainClaimedElsewhereDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}

function ClaimForm({ organization }: { organization: OrganizationDetail }) {
  const [, navigate] = usePortalHashLocation();
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [owner, setOwner] = useState<{ organizationId: string; organizationName: string } | null>(null);
  const form = useContractForm(organizationDomainClaimRequestSchema, {
    organizationId: organization.id,
    domain,
    reason,
  });
  const domainsHref = organizationRecordHref(organization.id, "/domains");

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setError("");
    setOwner(null);
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setSaving(true);
    try {
      const { organizationId, ...body } = checked.data;
      const endpoint = `/api/v1/organizations/${encodeURIComponent(organizationId)}/domains`;
      // The claim is refused here exactly as it would be, before anyone is asked to confirm it.
      const { preview } = await getJson(
        `${endpoint}/${encodeURIComponent(body.domain)}`,
        organizationDomainClaimPreviewResponseSchema,
      );
      const confirmed = await confirmAction({
        title: `Claim @${preview.domain} for ${organization.name}?`,
        body: "Verified addresses on this domain join the organization from now on.",
        consequences: [domainClaimReach(preview, organization.name)],
        confirmLabel: "Claim domain",
        cancelLabel: "Keep editing",
      });
      if (!confirmed) return;
      const response = await postJson(endpoint, body, organizationDomainClaimResponseSchema);
      toast(
        response.linking.continuing
          ? `${organization.name} claims @${response.domain.domain}; linking its people continues in the background`
          : `${organization.name} claims @${response.domain.domain}`,
        "success",
      );
      navigate(domainsHref);
    } catch (caught) {
      setOwner(claimedElsewhere(caught));
      setError(form.refuse(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel aria-label="Claim a domain">
      <PanelHeader title="Claim a domain" />
      <PanelBody>
        <form noValidate class="pk-stack pk-stack--snug" {...form.handlers} onSubmit={(event) => void submit(event)}>
          <Field
            label="Domain"
            required
            help={`Verified addresses on it and its subdomains join ${organization.name}. Free and disposable mail never can.`}
            {...form.of("domain")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="domain"
                value={domain}
                placeholder="example.com"
                autoComplete="off"
                onInput={(event) => setDomain(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field label="Reason" required help="Kept in the organization's history." {...form.of("reason")}>
            {(control) => (
              <Textarea
                {...control}
                name="reason"
                rows={3}
                value={reason}
                onInput={(event) => setReason(event.currentTarget.value)}
              />
            )}
          </Field>
          {owner ? (
            <Alert tone="warn" title={`${owner.organizationName} already claims this domain`}>
              The two records are probably one organization.{" "}
              <a href={usePortalHashLocation.hrefs(organizationRecordHref(owner.organizationId, "/merge"))}>
                Merge {owner.organizationName} into the organization that stays
              </a>
            </Alert>
          ) : (
            error && <Alert tone="danger">{error}</Alert>
          )}
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={saving}>
              Claim domain
            </Button>
            <ButtonLink variant="ghost" href={usePortalHashLocation.hrefs(domainsHref)}>
              Cancel
            </ButtonLink>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}

export function OrganizationDomainClaimForm({ organizationId }: { organizationId: string }) {
  const loaded = useOrganizationRecord(organizationId);
  const organization = loaded.data;
  return (
    <section class="pk pk-stack" aria-label="Claim a domain">
      <OrganizationRecordTrail
        organization={organization}
        via={[{ label: "Email domains", child: "/domains" }]}
        here="Claim a domain"
      />
      <ErrorAlert error={loaded.error} />
      {!organization ? (
        !loaded.error && <Spinner />
      ) : (
        <>
          <OrganizationRecordHero organization={organization} />
          <ClaimForm organization={organization} />
        </>
      )}
    </section>
  );
}
