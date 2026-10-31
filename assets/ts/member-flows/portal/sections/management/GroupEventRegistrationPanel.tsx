/** Group transport and event context around the canonical registration flow. */
import { useState } from "preact/hooks";
import { eventFormsResponseSchema } from "../../../../../shared/schemas/forms";
import {
  attendeeRegistrationParticipationSchema,
  registrationSubmissionResponseSchema,
} from "../../../../../shared/schemas/registration";
import type { GroupEvent } from "../../../../../shared/schemas/group-events";
import { RegistrationFlow } from "../../../../components/events/RegistrationFlow";
import { useData } from "../../../../hooks/useData";
import { getJson, postJson } from "../../../../shared/api-client";
import { parseQueryContext } from "../../../../shared/query-context";
import { Alert } from "../../../../ui/Alert";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Spinner } from "../../../../ui/Spinner";

export function GroupEventRegistrationPanel({ groupId, event }: { groupId: string; event: GroupEvent }) {
  if (!event.capabilities.includes("register")) return null;
  return <GroupRegistration groupId={groupId} event={event} />;
}
function GroupRegistration({ groupId, event }: { groupId: string; event: GroupEvent }) {
  const base = `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}`;
  const config = useData(() => getJson(`${base}/registration-config`, eventFormsResponseSchema), [base]);
  const [submitted, setSubmitted] = useState(false);
  const [revision, setRevision] = useState(0);
  if (config.loading) return <Spinner label="Loading registration…" />;
  if (!config.data) return <Alert tone="danger">{config.error}</Alert>;
  return (
    <Panel aria-label={`Register for ${event.name}`}>
      <PanelHeader title="Register for this event" />
      <PanelBody>
        {submitted && <Alert tone="ok">Registration submitted.</Alert>}
        <RegistrationFlow
          key={revision}
          mode="create"
          autoSession
          forms={config.data}
          context={{ eventSlug: event.slug, apiBase: "/api/v1", eventPagePath: null, query: parseQueryContext("") }}
          submit={(body) =>
            postJson(
              `${base}/registrations`,
              attendeeRegistrationParticipationSchema.parse({
                identityId: body.identityId,
                attendanceType: body.attendanceType,
                dayAttendance: body.dayAttendance,
                customAnswers: body.customAnswers,
                consents: body.consents,
              }),
              registrationSubmissionResponseSchema,
            )
          }
          onRegistered={() => {
            setSubmitted(true);
            setRevision((value) => value + 1);
          }}
        />
      </PanelBody>
    </Panel>
  );
}
