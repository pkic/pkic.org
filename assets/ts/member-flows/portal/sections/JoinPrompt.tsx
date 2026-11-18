/** Membership discovery reuses the verified public application flow. */
import type { z } from "zod";
import { myApplicationsListResponseSchema, myProfileSchema } from "../../../../shared/schemas/me";
import {
  organizationCurrentApplicationResponseSchema,
  type organizationCurrentApplicationSchema,
} from "../../../../shared/schemas/organization-self-service";
import type { SessionActingIdentity } from "../../../../shared/session-acting-identity";
import { getJson } from "../../../shared/api-client";
import { useData } from "../../../hooks/useData";
import { SupportBanner } from "../../../site/SupportBanner";
import { statusLabel } from "../../../components/Badge";
import { ButtonLink } from "../../../ui/Button";
import { DescriptionList } from "../../../ui/DescriptionList";
import { PersonCellPreview } from "../../../components/identities/PersonCellPreview";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { usePortalHashLocation } from "../hash-location";
import { fmtDate } from "../ui";
import { portalSession } from "../state";

type OrganizationApplication = z.infer<typeof organizationCurrentApplicationSchema> & { organizationName: string };

/** The open application of each organization the person represents, so a colleague waits for it rather than applying. */
async function representedOrganizationApplications(
  identities: readonly SessionActingIdentity[],
): Promise<OrganizationApplication[]> {
  const organizations = identities.filter((identity) => identity.organizationId);
  const found = await Promise.all(
    organizations.map(async (identity) => {
      const { application } = await getJson(
        `/api/v1/organizations/${encodeURIComponent(identity.organizationId!)}/applications/current`,
        organizationCurrentApplicationResponseSchema,
      );
      return application
        ? { ...application, organizationName: identity.organizationName ?? "Your organization" }
        : null;
    }),
  );
  return found.filter((application) => application !== null);
}

function OrganizationApplicationPanel({ application }: { application: OrganizationApplication }) {
  const applicant = application.applicant;
  return (
    <Panel>
      <PanelHeader title={`Membership application for ${application.organizationName}`} />
      <PanelBody class="pk-stack">
        <DescriptionList
          items={[
            { term: "Status", value: statusLabel(application.stage) },
            { term: "Applied", value: fmtDate(application.createdAt) },
            {
              term: "Applied by",
              value: applicant && (
                <div class="pk-cluster">
                  <PersonCellPreview
                    name={applicant.userName}
                    title={applicant.jobTitle}
                    avatarSrc={applicant.headshotUrl}
                  />
                  <ButtonLink href={`mailto:${applicant.email}`} external={false}>
                    Email {applicant.userName}
                  </ButtonLink>
                </div>
              ),
            },
          ]}
        />
        <p>
          You do not need to apply. Once the application is approved, you are admitted automatically as one of the
          organization&rsquo;s representatives and can join working groups here.
        </p>
      </PanelBody>
    </Panel>
  );
}

function NonMemberJoinPrompt({ userId, identities }: { userId: string; identities: readonly SessionActingIdentity[] }) {
  const status = useData(async () => {
    const [person, applications, organizationApplications] = await Promise.all([
      getJson("/api/v1/users/current", myProfileSchema),
      getJson("/api/v1/users/current/applications?limit=1", myApplicationsListResponseSchema),
      representedOrganizationApplications(identities),
    ]);
    return { person, applications, organizationApplications };
  }, [userId, identities.map((identity) => identity.organizationId ?? "").join()]);
  if (status.loading || status.error || !status.data || status.data.person.userId !== userId) return null;
  // Someone who has applied comes here to follow it, so it is the first thing their home offers.
  const application = status.data.applications.applications[0];
  if (application || status.data.applications.page.total > 0)
    return (
      <Panel>
        <PanelHeader title="Your membership application">
          <ButtonLink href={usePortalHashLocation.hrefs("/application")}>View application</ButtonLink>
        </PanelHeader>
        {application && (
          <PanelBody>
            <p>
              Status: {statusLabel(application.stage)}. Applied {fmtDate(application.createdAt)}.
            </p>
          </PanelBody>
        )}
      </Panel>
    );
  // A colleague's application already speaks for the organization; its representatives wait for it.
  const colleagues = status.data.organizationApplications.filter(
    (application) => application.applicant?.userId !== userId,
  );
  if (colleagues.length)
    return (
      <>
        {colleagues.map((application) => (
          <OrganizationApplicationPanel key={application.organizationName} application={application} />
        ))}
      </>
    );
  if (status.data.person.activeIdentities.length) return null;
  return (
    <SupportBanner
      variant="compact"
      reveal={false}
      heading="Help shape the future of digital trust"
      body="Join the PKI Consortium to contribute to working groups and collaborate with the PKI community. Use your organization’s email to apply for an organization, or choose individual membership if you participate independently."
      actions={
        <ButtonLink href="/join/" variant="primary">
          Explore membership
        </ButtonLink>
      }
    />
  );
}

export function JoinPrompt() {
  const session = portalSession.value;
  if (!session || session.member || session.pendingIdentityCount > 0) return null;
  return (
    <NonMemberJoinPrompt key={session.sessionId} userId={session.identity.id} identities={session.actingIdentities} />
  );
}
