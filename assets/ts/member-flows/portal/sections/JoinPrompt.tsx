/** Membership discovery reuses the verified public application flow. */
import { myApplicationsListResponseSchema, myProfileSchema } from "../../../../shared/schemas/me";
import { getJson } from "../../../shared/api-client";
import { useData } from "../../../hooks/useData";
import { SupportBanner } from "../../../site/SupportBanner";
import { statusLabel } from "../../../components/Badge";
import { ButtonLink } from "../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { usePortalHashLocation } from "../hash-location";
import { fmtDate } from "../ui";
import { portalSession } from "../state";

function NonMemberJoinPrompt({ userId }: { userId: string }) {
  const status = useData(async () => {
    const [person, applications] = await Promise.all([
      getJson("/api/v1/users/current", myProfileSchema),
      getJson("/api/v1/users/current/applications?limit=1", myApplicationsListResponseSchema),
    ]);
    return { person, applications };
  }, [userId]);
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
  return <NonMemberJoinPrompt key={session.sessionId} userId={session.identity.id} />;
}
