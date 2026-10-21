/**
 * Editing one identity's profile from the person's record: job title,
 * biography, links and visibility. A page of its own, never a form inside the
 * record's row. The person edits through their own-profile resource; staff
 * edit through the identity's staff resource.
 */
import { useData } from "../../../../hooks/useData";
import { getJson, patchJson } from "../../../../shared/api-client";
import { ownIdentityProfileSchema } from "../../../../../shared/schemas/own-identity-profile";
import { identityRecordSchema } from "../../../../../shared/schemas/identity-public-profile";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { IdentityProfileForm } from "../../../../components/identities/IdentityProfileForm";
import { identityResourcePath } from "../../../../components/identities/IdentityRecordEditor";
import { ownIdentityProfilePath } from "../../../../components/identities/OwnIdentityProfileEditor";
import { ButtonLink } from "../../../../ui/Button";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { toast } from "../../ui";
import { usePortalHashLocation } from "../../hash-location";

/** The page that edits one identity's profile, under the person's record. */
export function identityProfileEditPath(userId: string, identityId: string): string {
  return `/users/${encodeURIComponent(userId)}/affiliations/${encodeURIComponent(identityId)}/profile`;
}

export function IdentityProfilePage({
  userId,
  identityId,
  viewerIsSubject,
}: {
  userId: string;
  identityId: string;
  /** The reader is the person: they edit through their own resource, staff through the identity's. */
  viewerIsSubject: boolean;
}) {
  const [, navigate] = usePortalHashLocation();
  const recordPath = `/users/${encodeURIComponent(userId)}`;
  const { data, loading, error } = useData(
    () =>
      viewerIsSubject
        ? getJson(ownIdentityProfilePath(identityId), ownIdentityProfileSchema)
        : getJson(identityResourcePath(identityId), identityRecordSchema),
    [identityId, viewerIsSubject],
  );
  const subject = data ? (data.organizationName ?? "About you") : "Identity";
  const personName = data && "personName" in data ? String(data.personName) : null;
  return (
    <section class="pk pk-stack">
      <PageHeader
        trail={
          // The person reached their record as "My profile", not through the staff list of users.
          viewerIsSubject
            ? [{ label: "My profile", href: usePortalHashLocation.hrefs(recordPath) }, { label: subject }]
            : [
                { label: "Users", href: usePortalHashLocation.hrefs("/users") },
                { label: personName ?? "Person", href: usePortalHashLocation.hrefs(recordPath) },
                { label: subject },
              ]
        }
        title={`Edit profile: ${subject}`}
        description={
          data?.organizationId
            ? `Your role, bio, and links for ${subject}. Your general introduction is edited in About you.`
            : "A general introduction covering interests and roles. Organization-specific bios are edited on their own profiles."
        }
      />
      {loading && !data ? <Spinner /> : null}
      {error && !data ? <ErrorAlert error={error} /> : null}
      {data ? (
        <Panel aria-label={`Edit profile: ${subject}`}>
          <PanelBody>
            <IdentityProfileForm
              key={data.identityId}
              identity={data}
              editor={viewerIsSubject ? "owner" : "staff"}
              save={(body) =>
                viewerIsSubject
                  ? patchJson(ownIdentityProfilePath(data.identityId), body, ownIdentityProfileSchema)
                  : patchJson(identityResourcePath(data.identityId), body, identityRecordSchema)
              }
              onSaved={() => {
                toast("Identity profile updated", "success");
                navigate(recordPath);
              }}
              cancel={<ButtonLink href={usePortalHashLocation.hrefs(recordPath)}>Cancel</ButtonLink>}
            />
          </PanelBody>
        </Panel>
      ) : null}
    </section>
  );
}
