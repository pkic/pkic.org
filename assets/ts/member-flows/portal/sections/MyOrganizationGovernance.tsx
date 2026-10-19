import { useEffect, useState } from "preact/hooks";
import {
  organizationActiveSponsorshipResponseSchema,
  organizationSecondaryContactNominationResponseSchema,
  organizationSecondaryContactNominationSchema,
} from "../../../../shared/schemas/organization-self-service";
import { statusLabel } from "../../../components/Badge";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Spinner } from "../../../components/Spinner";
import { useContractForm } from "../../../hooks/useContractForm";
import { Button } from "../../../ui/Button";
import { DescriptionList } from "../../../ui/DescriptionList";
import { PersonCellPreview } from "../../../components/identities/PersonCellPreview";
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
  const profile = profileSignal.value;
  const identities = (profile?.organizationId === organizationId ? (profile.organizationIdentities ?? []) : []).filter(
    (identity) => !identity.isPrimaryContact && identity.userId !== org.primaryContact?.userId,
  );
  const [value, setValue] = useState(org.pendingSecondaryContactUserId ?? "");
  const [saving, setSaving] = useState(false);
  const form = useContractForm(
    organizationSecondaryContactNominationSchema,
    { userId: value },
    { quietWhenEmpty: true },
  );

  useEffect(() => setValue(org.pendingSecondaryContactUserId ?? ""), [org.pendingSecondaryContactUserId]);

  async function handleChange(next: string): Promise<void> {
    setValue(next);
    setSaving(true);
    try {
      const path = `${organizationPath(organizationId)}/contacts/secondary/nomination`;
      if (next) {
        const checked = form.submit();
        if (!checked.data) return;
        await putJson(path, checked.data, organizationSecondaryContactNominationResponseSchema);
      } else {
        await deleteJson(path, organizationSecondaryContactNominationResponseSchema);
      }
      toast(next ? "Secondary contact nominated — pending staff confirmation" : "Nomination withdrawn", "success");
      await reload();
    } catch (error) {
      setValue(org.pendingSecondaryContactUserId ?? "");
      form.refuse(error);
      toast(error instanceof ApiClientError ? error.message : "Could not update nomination.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!org.isPrimaryContact && !org.pendingSecondaryContactUserId) return null;

  return (
    <div class="pk-stack pk-stack--snug">
      {org.pendingSecondaryContactUserId && (
        <p>
          Pending staff confirmation: {org.pendingSecondaryContact?.userName ?? "Nominee no longer available"}.
          {org.secondaryContact && " The current secondary contact remains assigned until confirmation."}
        </p>
      )}
      {org.isPrimaryContact && (
        <form
          noValidate
          {...form.handlers}
          class="pk-stack pk-stack--snug"
          onSubmit={(event) => {
            event.preventDefault();
            void handleChange(value);
          }}
        >
          <Field
            label={org.secondaryContact ? "Replacement nominee" : "Nominee"}
            help={
              org.secondaryContact
                ? "A replacement takes effect after staff confirmation."
                : "Nominate a secondary contact for staff confirmation."
            }
            {...form.of("userId")}
          >
            {(control) => (
              <Select
                {...control}
                name="userId"
                class="portal-identity-select"
                value={value}
                disabled={saving}
                onChange={(event) => setValue((event.target as HTMLSelectElement).value)}
              >
                <option value="">None</option>
                {identities.map((identity) => (
                  <option key={identity.identityId} value={identity.userId}>
                    {identity.name ?? identity.email}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div class="pk-cluster">
            <Button type="submit" variant="primary" disabled={saving || !form.valid}>
              Send nomination
            </Button>
            {org.pendingSecondaryContactUserId && (
              <Button type="button" disabled={saving} onClick={() => void handleChange("")}>
                Withdraw nomination
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
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
    <Panel class="pk" aria-label="Contacts">
      <PanelHeader title="Contacts" />
      <PanelBody class="pk-stack pk-stack--loose">
        <DescriptionList
          items={[
            {
              term: "Your role",
              value: org.isPrimaryContact
                ? "Primary contact"
                : org.isSecondaryContact
                  ? "Secondary contact"
                  : "Representative",
            },
            ...(
              [
                ["Primary contact", org.primaryContact],
                ["Secondary contact", org.secondaryContact],
              ] as const
            ).map(([term, identity]) => ({
              term,
              value: identity ? (
                <PersonCellPreview
                  name={identity.userName}
                  title={identity.jobTitle}
                  avatarSrc={identity.headshotUrl}
                />
              ) : (
                "Not assigned"
              ),
            })),
          ]}
        />
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
