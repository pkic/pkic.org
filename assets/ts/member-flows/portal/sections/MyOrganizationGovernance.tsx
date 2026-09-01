import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  organizationActiveSponsorshipResponseSchema,
  organizationSecondaryContactNominationResponseSchema,
} from "../../../../shared/schemas/organization-self-service";
import { statusLabel } from "../../../components/Badge";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { Field } from "../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { Select } from "../../../ui/TextControl";
import { ApiClientError, deleteJson, getJson, putJson } from "../../../shared/api-client";
import { profile as profileSignal } from "../state";
import type { MyOrganizationProfile, MyOrganizationSponsorship } from "../types";
import { fmtDate, toast } from "../ui";

function organizationPath(organizationId: string): string {
  return `/api/v1/organizations/${encodeURIComponent(organizationId)}`;
}

function SecondaryContactSection({
  organizationId,
  org,
  reload,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
}) {
  const identities = (profileSignal.value?.organizationIdentities ?? []).filter(
    (identity) => !identity.isPrimaryContact,
  );
  const [value, setValue] = useState(org.pendingSecondaryContactUserId ?? "");
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(org.pendingSecondaryContactUserId ?? ""), [org.pendingSecondaryContactUserId]);

  async function handleChange(next: string): Promise<void> {
    setValue(next);
    setSaving(true);
    try {
      const path = `${organizationPath(organizationId)}/contacts/secondary/nomination`;
      if (next) {
        await putJson(path, { userId: next }, organizationSecondaryContactNominationResponseSchema);
      } else {
        await deleteJson(path, organizationSecondaryContactNominationResponseSchema);
      }
      toast(next ? "Secondary contact nominated — pending staff confirmation" : "Nomination withdrawn", "success");
      await reload();
    } catch (error) {
      setValue(org.pendingSecondaryContactUserId ?? "");
      toast(error instanceof ApiClientError ? error.message : "Could not update nomination.", "error");
    } finally {
      setSaving(false);
    }
  }

  const nominee = identities.find((identity) => identity.userId === org.pendingSecondaryContactUserId);
  return (
    <div class="pk-stack pk-stack--snug">
      <h4>Secondary contact</h4>
      {org.isPrimaryContact ? (
        // The selector used to carry no label at all — only the heading above
        // it, which a screen reader does not attach to a control. The Field
        // supplies the for/id pair and hangs the explanation off the control
        // through aria-describedby rather than leaving it as loose prose.
        <Field
          label="Nominated secondary contact"
          help="A second organization identity that can manage the organization profile. Nominations are held until confirmed by staff."
        >
          {(control) => (
            <IdentitySelect
              {...control}
              className="portal-identity-select"
              value={value}
              disabled={saving}
              emptyLabel="None"
              identities={identities}
              onChange={(event) => void handleChange((event.target as HTMLSelectElement).value)}
            />
          )}
        </Field>
      ) : (
        <>
          <p class="pk-small">
            A second organization identity that can manage the organization profile. Nominations are held until
            confirmed by staff.
          </p>
          <p>
            {org.pendingSecondaryContactUserId
              ? `Pending: ${nominee?.name ?? nominee?.email ?? "an identity"}`
              : "None pending"}
          </p>
        </>
      )}
    </div>
  );
}

export interface IdentitySelectProps extends Omit<
  JSX.SelectHTMLAttributes<HTMLSelectElement>,
  "value" | "onChange" | "class"
> {
  /** A surface-local layout class, e.g. the portal's measured select width. */
  className?: string;
  value: string;
  disabled?: boolean;
  emptyLabel: string;
  identities: Array<{ userId: string; name: string | null; email: string }>;
  onChange: (event: Event) => void;
}

/**
 * The organization's identities as a choice.
 *
 * It takes the rest of its props through, so a `Field` can hand it the id and
 * the ARIA the control has to carry: the selector is meaningless without a
 * name, and generating one inside here would compete with the caller's label.
 */
export function IdentitySelect({
  className,
  value,
  disabled,
  emptyLabel,
  identities,
  onChange,
  ...rest
}: IdentitySelectProps) {
  return (
    <Select {...rest} class={className} value={value} disabled={disabled} onChange={onChange}>
      <option value="">{emptyLabel}</option>
      {identities.map((identity) => (
        <option key={identity.userId} value={identity.userId}>
          {identity.name ?? identity.email}
        </option>
      ))}
    </Select>
  );
}

export function OrganizationGovernanceCard({
  organizationId,
  org,
  reload,
}: {
  organizationId: string;
  org: MyOrganizationProfile;
  reload: () => Promise<void>;
}) {
  return (
    <Panel class="pk" aria-label="Governance">
      <PanelHeader title="Governance" />
      <PanelBody class="pk-stack pk-stack--loose">
        <SecondaryContactSection organizationId={organizationId} org={org} reload={reload} />
      </PanelBody>
    </Panel>
  );
}

export function OrganizationSponsorshipCard({ organizationId }: { organizationId: string }) {
  const [sponsorship, setSponsorship] = useState<MyOrganizationSponsorship | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJson(`${organizationPath(organizationId)}/sponsors/current`, organizationActiveSponsorshipResponseSchema)
      .then((response) => setSponsorship(response.sponsorship))
      .catch((cause: unknown) =>
        setError(cause instanceof ApiClientError ? cause.message : "Could not load sponsorship."),
      );
  }, [organizationId]);

  return (
    <Panel class="pk" aria-label="Sponsorship">
      <PanelHeader title="Sponsorship" />
      <PanelBody>
        {error && <ErrorAlert error={error} />}
        {!sponsorship && !error ? (
          <Spinner label="Loading sponsorship…" />
        ) : sponsorship?.tier ? (
          <p>
            {/* The tier is capitalized by the shared status vocabulary rather
                than by a text-transform, so the word reaches assistive
                technology the same way it reaches the screen. */}
            Active <span class="pk-strong">{statusLabel(sponsorship.tier)}</span> sponsor
            {sponsorship.startDate && <> since {fmtDate(sponsorship.startDate)}</>}.
          </p>
        ) : (
          <p class="pk-muted">Your organization is not currently a consortium sponsor.</p>
        )}
      </PanelBody>
    </Panel>
  );
}
