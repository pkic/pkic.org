import { SessionHolds } from "./SessionHolds";
import { useEffect, useState } from "preact/hooks";
import { z } from "zod";
import {
  sessionInvitationRequestSchema,
  sessionInvitationResponseSchema,
  sessionDelegationRequestSchema,
  sessionManagementInfoSchema,
} from "../../../../../../../shared/schemas/event-session-management";
import {
  sessionHoldRequestSchema,
  sessionHoldResponseSchema,
} from "../../../../../../../shared/schemas/event-session-holds";
import { badgeAttendeesResponseSchema } from "../../../../../../../shared/schemas/route-contracts-event-badges";
import { getJson, putJson, postJson } from "../../../../../../shared/api-client";
import { UserPicker, type PickedUser } from "../../../../../../components/UserPicker";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Button } from "../../../../../../ui/Button";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
type InvitationAction = z.infer<typeof sessionInvitationRequestSchema>["action"];
/** The commands the form submits; revoking is its own confirmed action, never a choice in the select. */
const INVITATION_ACTIONS = {
  invite: "Send invitation",
  add: "Confirm registration",
} satisfies Partial<Record<InvitationAction, string>>;
type GrantingAction = keyof typeof INVITATION_ACTIONS;
export function SessionManagementTools({
  slug,
  occurrenceId,
  onChanged,
}: {
  slug: string;
  occurrenceId: string;
  onChanged: () => void;
}) {
  const endpoint = `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${occurrenceId}`;
  const [info, setInfo] = useState<z.infer<typeof sessionManagementInfoSchema> | null>(null),
    [user, setUser] = useState<PickedUser | null>(null);
  const [mode, setMode] = useState<"physical" | "remote">("physical"),
    [action, setAction] = useState<GrantingAction>("invite"),
    [reason, setReason] =
      useState<z.infer<typeof sessionInvitationRequestSchema>["reasonCode"]>("organizer_invitation");
  const [holdsRevision, setHoldsRevision] = useState(0);
  const [speaker, setSpeaker] = useState(""),
    [enabled, setEnabled] = useState(true),
    [hold, setHold] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const invitation = useContractForm(sessionInvitationRequestSchema, {
    userId: user?.id ?? "",
    attendanceMode: mode,
    action,
    reasonCode: reason,
  });
  const revocation = useContractForm(sessionInvitationRequestSchema, {
    userId: user?.id ?? "",
    attendanceMode: mode,
    action: "revoke",
    reasonCode: reason,
  });
  const delegation = useContractForm(sessionDelegationRequestSchema, { userId: speaker, enabled });
  useEffect(() => {
    const controller = new AbortController();
    setInfo(null);
    setUser(null);
    setSpeaker("");
    setMessage("");
    void getJson(`${endpoint}/management`, sessionManagementInfoSchema, { signal: controller.signal })
      .then(setInfo)
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Session management is unavailable.");
      });
    return () => controller.abort();
  }, [endpoint]);
  async function invite(event: Event) {
    event.preventDefault();
    await send(invitation);
  }
  async function revoke() {
    if (!user) {
      setError(revocation.submit().formMessage ?? "");
      return;
    }
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
    const confirmed = await confirmAction({
      title: `Revoke ${name}'s invitation to this session?`,
      consequences: [
        `${name} can no longer register for this session through the invitation`,
        "Their session registration is canceled when the session is invitation-only or private",
      ],
      confirmLabel: "Revoke invitation",
      cancelLabel: "Keep invitation",
      tone: "danger",
    });
    if (confirmed) await send(revocation);
  }
  async function send(command: typeof invitation) {
    const checked = command.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    const sent = checked.data.action;
    setBusy(true);
    setError("");
    try {
      await putJson(`${endpoint}/invitations`, checked.data, sessionInvitationResponseSchema);
      if (hold && sent === "invite" && info?.canDelegate)
        await postJson(
          `${endpoint}/holds`,
          sessionHoldRequestSchema.parse({
            userId: checked.data.userId,
            attendanceMode: mode,
            reasonCode: "organizer_invitation",
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
          sessionHoldResponseSchema,
        );
      setMessage(
        sent === "invite"
          ? hold
            ? "Invitation sent; capacity held for one hour."
            : "Invitation sent. No seat is held until registration is confirmed."
          : sent === "add"
            ? "Session registration reviewed. The attendee may be waitlisted if capacity is full."
            : "Invitation revoked.",
      );
      setUser(null);
      setHoldsRevision((value) => value + 1);
      onChanged();
    } catch (error) {
      setError(command.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  async function delegate(event: Event) {
    event.preventDefault();
    const checked = delegation.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await putJson(`${endpoint}/delegation`, checked.data, z.object({ enabled: z.boolean() }));
      setMessage(
        enabled ? "Speaker can now manage this session's invitations and approvals." : "Speaker delegation revoked.",
      );
    } catch (error) {
      setError(delegation.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Session invitation and delegation tools">
      <SectionHeading level={4}>Invitations</SectionHeading>
      <p>
        An invitation grants access to this session. It does not create event registration, approval, or a reserved
        seat.
      </p>
      <form noValidate {...invitation.handlers} onSubmit={invite} class="pk-form">
        <Field label="Attendee" {...invitation.of("userId")}>
          {(control) => (
            <UserPicker
              value={user}
              onChange={setUser}
              inputProps={{ ...control, name: "userId" }}
              endpoint={`${endpoint}/invitees`}
              responseSchema={badgeAttendeesResponseSchema}
              disabled={busy}
            />
          )}
        </Field>
        <Field label="Action" {...invitation.of("action")}>
          {(control) => (
            <Select
              {...control}
              name="action"
              value={action}
              onChange={(event) => setAction(event.currentTarget.value as typeof action)}
            >
              {Object.entries(INVITATION_ACTIONS).map(([value, label]) => (
                <option value={value}>{label}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Attendance" {...invitation.of("attendanceMode")}>
          {(control) => (
            <Select
              {...control}
              name="attendanceMode"
              value={mode}
              onChange={(event) => setMode(event.currentTarget.value as typeof mode)}
            >
              {sessionInvitationRequestSchema.shape.attendanceMode.options.map((value) => (
                <option value={value}>{value === "physical" ? "In person" : "Remote"}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Reason" {...invitation.of("reasonCode")}>
          {(control) => (
            <Select
              {...control}
              name="reasonCode"
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value as typeof reason)}
            >
              {sessionInvitationRequestSchema.shape.reasonCode.options.map((value) => (
                <option value={value}>{value.replaceAll("_", " ")}</option>
              ))}
            </Select>
          )}
        </Field>
        {info?.canDelegate && action === "invite" && (
          <Checkbox
            label="Hold a seat for one hour (counts against capacity)"
            checked={hold}
            onInput={(event) => setHold(event.currentTarget.checked)}
          />
        )}
        <div class="pk-cluster">
          <Button type="submit" variant="primary" loading={busy}>
            {INVITATION_ACTIONS[action]}
          </Button>
          <Button type="button" variant="danger-quiet" disabled={busy} onClick={() => void revoke()}>
            Revoke invitation…
          </Button>
        </div>
      </form>
      {info?.canDelegate && info.speakers.length > 0 && (
        <>
          <SectionHeading level={4}>Speaker delegation</SectionHeading>
          <form noValidate {...delegation.handlers} onSubmit={delegate} class="pk-form">
            <Field label="Assigned speaker" {...delegation.of("userId")}>
              {(control) => (
                <Select
                  {...control}
                  name="userId"
                  value={speaker}
                  onChange={(event) => setSpeaker(event.currentTarget.value)}
                >
                  <option value="">Choose a speaker</option>
                  {info.speakers.map((person) => (
                    <option value={person.userId}>{person.displayName}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Management authority" {...delegation.of("enabled")}>
              {(control) => (
                <Checkbox
                  {...control}
                  name="enabled"
                  label="Allow invitations and approvals for this session"
                  checked={enabled}
                  onInput={(event) => setEnabled(event.currentTarget.checked)}
                />
              )}
            </Field>
            <Button type="submit" loading={busy}>
              Save delegation
            </Button>
          </form>
        </>
      )}
      {info?.canDelegate && <SessionHolds endpoint={endpoint} onChanged={onChanged} refreshKey={holdsRevision} />}
      {message && <p role="status">{message}</p>}
      {error && <ErrorAlert error={error} />}
    </section>
  );
}
