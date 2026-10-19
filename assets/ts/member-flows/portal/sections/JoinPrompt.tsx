/** Membership discovery reuses the verified public application flow. */
import { myApplicationsListResponseSchema, myProfileSchema } from "../../../../shared/schemas/me";
import { getJson } from "../../../shared/api-client";
import { useData } from "../../../hooks/useData";
import { SupportBanner } from "../../../site/SupportBanner";
import { ButtonLink } from "../../../ui/Button";
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
  if (status.data.person.activeIdentities.length || status.data.applications.page.total) return null;
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
