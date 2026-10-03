import { useRef, useState } from "preact/hooks";
import { type z } from "zod";
import {
  personalAgendaResponseSchema,
  personalAgendaSessionSchema,
} from "../../../../../../../shared/schemas/event-personal-agenda";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../../../../../../../shared/schemas/event-participation-scanning";
import { ApiDataTable, type ApiTableActions } from "../../../../../../components/ApiDataTable";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { putJson } from "../../../../../../shared/api-client";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
type Session = z.infer<typeof personalAgendaSessionSchema>;
const ACTION_LABELS = {
  save: "Save preference",
  reserve: "Reserve a place",
  request: "Request approval",
  cancel: "Remove from my agenda",
};
function ParticipationControls({ slug, session, onSaved }: { slug: string; session: Session; onSaved: () => void }) {
  const [action, setAction] = useState<z.infer<typeof sessionParticipationRequestSchema>["action"]>("save");
  const [attendanceMode, setMode] = useState<"physical" | "remote">(session.attendanceMode ?? "physical");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(sessionParticipationRequestSchema, { action, attendanceMode });
  async function submit(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await putJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/${session.id}/participation`,
        checked.data,
        sessionParticipationResponseSchema,
      );
      onSaved();
    } catch (error) {
      setError(form.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form noValidate {...form.handlers} onSubmit={submit}>
      <Field label="Participation" {...form.of("action")}>
        {(control) => (
          <Select
            {...control}
            name="action"
            value={action}
            onChange={(event) => setAction(event.currentTarget.value as typeof action)}
          >
            {sessionParticipationRequestSchema.shape.action.options
              .filter((value) => value !== "request" || session.admissionPolicy === "approval")
              .map((value) => (
                <option value={value}>{ACTION_LABELS[value]}</option>
              ))}
          </Select>
        )}
      </Field>
      <Field label="Attendance" {...form.of("attendanceMode")}>
        {(control) => (
          <Select
            {...control}
            name="attendanceMode"
            value={attendanceMode}
            onChange={(event) => setMode(event.currentTarget.value as typeof attendanceMode)}
          >
            {sessionParticipationRequestSchema.shape.attendanceMode.options.map((value) => (
              <option value={value}>{value === "physical" ? "In person" : "Remote"}</option>
            ))}
          </Select>
        )}
      </Field>
      <Button type="submit" loading={busy}>
        Update
      </Button>
      {error && <ErrorAlert error={error} />}
    </form>
  );
}
export function MyAgenda({ slug }: { slug: string }) {
  const actions = useRef<ApiTableActions | null>(null);
  return (
    <>
      <p>Saving a preference does not guarantee admission. Reserve a place where registration is required.</p>
      <ApiDataTable<Session, z.infer<typeof personalAgendaResponseSchema>>
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/agenda/participation`}
        caption="My event agenda"
        responseSchema={personalAgendaResponseSchema}
        resolve={(value) => value.sessions}
        resolvePage={(value) => value.page}
        paginate
        initialSort="startAt"
        rowKey={(row) => row.id}
        actionsRef={actions}
        searchPlaceholder="Find a session…"
        empty="No sessions match your search."
        columns={[
          { header: "Session", sort: { asc: "title", desc: "-title" }, cell: (row) => row.title },
          { header: "My agenda", cell: (row) => row.status?.replaceAll("_", " ") ?? "Not saved" },
          {
            header: "Participation",
            cell: (row) => (
              <ParticipationControls
                slug={slug}
                session={row}
                onSaved={() => {
                  void actions.current?.reload();
                }}
              />
            ),
          },
        ]}
      />
    </>
  );
}
