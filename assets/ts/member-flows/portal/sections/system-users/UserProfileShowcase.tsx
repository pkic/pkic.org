/**
 * A person's professional profile inside the portal, under their record.
 *
 * It is the same `ProfileShowcase` the public page at /people/<slug>/ renders,
 * from the same projection. Its subject reads it in owner mode: what is not
 * published is listed and marked, and the commands lead to the record's own
 * edit view and to the public page. Staff read what the public reads, with a
 * link to the public page once the site renders one.
 */
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { personProfileResponseSchema } from "../../../../../shared/schemas/person-profile";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { Breadcrumb } from "../../../../ui/Breadcrumb";
import { ButtonLink } from "../../../../ui/Button";
import { ProfileShowcase } from "../../../../site/ProfileShowcase";
import { Badge } from "../../../../ui/Badge";
import { JOB_TITLE_NEEDED_LABEL } from "../../../../../shared/schemas/identity-job-title";
import { usePortalHashLocation } from "../../hash-location";

/** The owner's edit view of one identity they hold, under their professional profile. */
export function identityProfileEditPath(userId: string, identityId: string): string {
  return `/users/${encodeURIComponent(userId)}/profile/${encodeURIComponent(identityId)}/edit`;
}

export function UserProfileShowcase({ userId, canRead }: { userId: string; canRead: boolean }) {
  const recordPath = `/users/${encodeURIComponent(userId)}`;
  const { data, loading, error } = useData(
    async () =>
      canRead ? getJson(`/api/v1/users/${encodeURIComponent(userId)}/profile`, personProfileResponseSchema) : null,
    [canRead, userId],
  );
  if (!canRead) return <p class="pk-muted">Profiles of other people require the users:read permission.</p>;
  if (loading && !data) return <Spinner />;
  if (error && !data) return <ErrorAlert error={error} />;
  if (!data) return null;
  const { profile, audience } = data;
  const publicPage = profile.route ? (
    <ButtonLink href={profile.route} external>
      View public page
    </ButtonLink>
  ) : null;
  return (
    <section class="pk pk-stack">
      <Breadcrumb
        items={[
          { label: "Users", href: usePortalHashLocation.hrefs("/users") },
          { label: profile.name, href: usePortalHashLocation.hrefs(recordPath) },
          { label: "Professional profile" },
        ]}
      />
      {audience === "public" && publicPage ? <div class="pk-cluster">{publicPage}</div> : null}
      <ProfileShowcase
        profile={profile}
        mode={audience}
        // An identity the person still holds opens its own edit view; an ended one is a record of the past.
        identityAction={(identity) =>
          identity.endedAt === null ? (
            <span class="pk-cluster">
              {/* An organization identity always has a job title; one saved before that rule asks for it. */}
              {identity.organization && !identity.title?.trim() && <Badge tone="warn">{JOB_TITLE_NEEDED_LABEL}</Badge>}
              <ButtonLink
                href={usePortalHashLocation.hrefs(identityProfileEditPath(userId, identity.id))}
                aria-label={`Edit ${identity.title ?? identity.organization?.name ?? "this identity"}`}
              >
                Edit
              </ButtonLink>
            </span>
          ) : null
        }
        actions={
          <>
            <ButtonLink variant="primary" href={usePortalHashLocation.hrefs(`${recordPath}/edit`)}>
              Edit profile
            </ButtonLink>
            {publicPage}
          </>
        }
      />
    </section>
  );
}
