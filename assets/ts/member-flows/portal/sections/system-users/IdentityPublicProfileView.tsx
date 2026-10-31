/**
 * Staff deciding whether one identity shows on its person's public profile.
 *
 * Identities are not hidden in principle: every identity, ended ones as past,
 * shows on the profile. Withholding one is an administrator's decision on the
 * identity itself, made here in a view of its own and audited, never a choice
 * the person makes for themselves.
 */
import { useState } from "preact/hooks";
import { useData } from "../../../../hooks/useData";
import { useContractForm } from "../../../../hooks/useContractForm";
import { getJson, patchJson } from "../../../../shared/api-client";
import {
  identityPublicProfileSchema,
  identityPublicProfileUpdateSchema,
  type IdentityPublicProfile,
} from "../../../../../shared/schemas/identity-public-profile";
import { ErrorAlert, friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Alert } from "../../../../ui/Alert";
import { Button, ButtonLink } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { toast } from "../../ui";
import { usePortalHashLocation } from "../../hash-location";
import { identityResourcePath as identityApi } from "../../../../components/identities/IdentityRecordEditor";

/** The staff view of one identity's place on the public profile, under the person's record. */
export function identityPublicProfilePath(userId: string, identityId: string): string {
  return `/users/${encodeURIComponent(userId)}/affiliations/${encodeURIComponent(identityId)}/public-profile`;
}

function IdentityPublicProfileForm({ identity, recordPath }: { identity: IdentityPublicProfile; recordPath: string }) {
  const [, navigate] = usePortalHashLocation();
  const [hidden, setHidden] = useState(identity.hiddenFromPublicProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useContractForm(identityPublicProfileUpdateSchema, { hiddenFromPublicProfile: hidden });

  async function save(event: Event) {
    event.preventDefault();
    setError(null);
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage);
      return;
    }
    setSaving(true);
    try {
      await patchJson(identityApi(identity.identityId), checked.data, identityPublicProfileSchema);
      toast(
        checked.data.hiddenFromPublicProfile ? "Hidden from the public profile" : "Shown on the public profile",
        "success",
      );
      navigate(recordPath);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      noValidate
      class="pk-stack"
      {...form.handlers}
      onSubmit={(event) => {
        void save(event);
      }}
    >
      <Checkbox
        name="hiddenFromPublicProfile"
        checked={hidden}
        onChange={(event) => setHidden(event.currentTarget.checked)}
        label="Hide this identity from the public profile"
        hint={`${identity.personName} still sees it on their own profile, marked as hidden by an administrator.`}
      />
      {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}
      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <ButtonLink href={usePortalHashLocation.hrefs(recordPath)}>Cancel</ButtonLink>
      </div>
    </form>
  );
}

export function IdentityPublicProfileView({ userId, identityId }: { userId: string; identityId: string }) {
  const recordPath = `/users/${encodeURIComponent(userId)}`;
  const { data, loading, error } = useData(
    () => getJson(identityApi(identityId), identityPublicProfileSchema),
    [identityId],
  );
  const subject = data ? (data.organizationName ?? "Individual identity") : "Identity";
  return (
    <section class="pk pk-stack">
      <PageHeader
        trail={[
          { label: "Users", href: usePortalHashLocation.hrefs("/users") },
          { label: data?.personName ?? "Person", href: usePortalHashLocation.hrefs(recordPath) },
          { label: subject },
        ]}
        title={`Public profile: ${subject}`}
        description="Every identity shows on the person's public profile, an ended one as past, unless an administrator hides it."
      />
      {loading && !data ? <Spinner /> : null}
      {error && !data ? <ErrorAlert error={error} /> : null}
      {data ? (
        <Panel aria-label={`Public profile: ${subject}`}>
          <PanelBody>
            <IdentityPublicProfileForm key={data.identityId} identity={data} recordPath={recordPath} />
          </PanelBody>
        </Panel>
      ) : null}
    </section>
  );
}
