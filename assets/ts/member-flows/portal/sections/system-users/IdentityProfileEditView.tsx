/**
 * Editing one identity the person holds, opened from their professional
 * profile. A page of its own, never a form inside the showcase: the job
 * title, biography and links that every record made as the identity and the
 * public profile show. The session keeps acting as the identity it already
 * does; only the identity named in the address changes.
 */
import { useData } from "../../../../hooks/useData";
import { getJson, patchJson } from "../../../../shared/api-client";
import { ownIdentityProfileSchema } from "../../../../../shared/schemas/own-identity-profile";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { IdentityProfileForm } from "../../../../components/identities/IdentityProfileForm";
import { ButtonLink } from "../../../../ui/Button";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { toast } from "../../ui";
import { usePortalHashLocation } from "../../hash-location";

const identityProfileApi = (identityId: string) =>
  `/api/v1/users/current/identities/${encodeURIComponent(identityId)}/profile`;

export function IdentityProfileEditView({ userId, identityId }: { userId: string; identityId: string }) {
  const [, navigate] = usePortalHashLocation();
  const profilePath = `/users/${encodeURIComponent(userId)}/profile`;
  const { data, loading, error } = useData(
    () => getJson(identityProfileApi(identityId), ownIdentityProfileSchema),
    [identityId],
  );
  const name = data ? (data.organizationName ?? "Individual identity") : "Identity";
  return (
    <section class="pk pk-stack">
      <PageHeader
        trail={[{ label: "Professional profile", href: usePortalHashLocation.hrefs(profilePath) }, { label: name }]}
        title={`Edit ${name}`}
        description="How this identity appears on your records and on your public profile."
      />
      {loading && !data ? <Spinner /> : null}
      {error && !data ? <ErrorAlert error={error} /> : null}
      {data ? (
        <Panel aria-label={`Edit ${name}`}>
          <PanelBody>
            <IdentityProfileForm
              key={data.identityId}
              identity={data}
              editor="owner"
              save={(body) => patchJson(identityProfileApi(data.identityId), body, ownIdentityProfileSchema)}
              onSaved={() => {
                toast("Identity updated", "success");
                navigate(profilePath);
              }}
              cancel={<ButtonLink href={usePortalHashLocation.hrefs(profilePath)}>Cancel</ButtonLink>}
            />
          </PanelBody>
        </Panel>
      ) : null}
    </section>
  );
}
