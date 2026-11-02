import { dateTimeLocalToIso } from "../../../../../../shared/timezone";
import { useState } from "preact/hooks";
import { UserPicker, type PickedUser } from "../../../../../components/UserPicker";
import { Alert } from "../../../../../ui/Alert";
import { Button, ButtonLink } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { Select, TextInput } from "../../../../../ui/TextControl";
import { usePortalHashLocation } from "../../../hash-location";
import { useContractForm } from "../../../../../hooks/useContractForm";
import { postJson } from "../../../../../shared/api-client";
import {
  EVENT_TEAM_ROLES,
  eventTeamRoleCreateResponseSchema,
  eventTeamRoleCreateSchema,
  type EventTeamRole,
} from "../../../../../../shared/schemas/event-team";
import { performAction } from "../../../actions";

/** The typed wall clock as an instant in the event's zone; a time the zone skips stays as typed so the contract refuses it on the field. */
function eventExpiry(value: string, timeZone: string): string {
  try {
    return dateTimeLocalToIso(value, timeZone);
  } catch {
    return value;
  }
}

export const ROLE_LABELS: Record<EventTeamRole, string> = {
  organizer: "Organizer",
  program_committee: "Program Committee",
  moderator: "Moderator",
  volunteer: "Volunteer",
};

/**
 * Adding a team member: a page of its own under the roster, never a form
 * unfolding above it. The person is found with the user picker — a team
 * member is an existing user, linked, not an address that becomes an account
 * (#88) — and the way back is the roster's own address.
 */
export function AddTeamMemberPage({
  slug,
  teamPath,
  timeZone,
  person,
}: {
  slug: string;
  teamPath: string;
  timeZone: string;
  person?: PickedUser;
}) {
  const [, navigate] = usePortalHashLocation();
  const [picked, setPicked] = useState<PickedUser | null>(person ?? null);
  const [role, setRole] = useState<EventTeamRole>("organizer");
  const [expiresAt, setExpiresAt] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  // One basis for validation: the assignment contract the route parses checks
  // the draft as it is built and is the only thing that may refuse it.
  const form = useContractForm(eventTeamRoleCreateSchema, {
    userId: picked?.id ?? "",
    role,
    ...(expiresAt ? { expiresAt: eventExpiry(expiresAt, timeZone) } : {}),
  });

  async function handleAdd(event: Event): Promise<void> {
    event.preventDefault();
    setError("");
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    await performAction({
      setBusy: setAdding,
      request: () =>
        postJson(`/api/v1/events/${encodeURIComponent(slug)}/roles`, checked.data, eventTeamRoleCreateResponseSchema),
      successMessage: "Event access granted",
      // Back to the roster, which fetches on its own when it mounts.
      afterSuccess: () => navigate(teamPath),
      onError: setError,
    });
  }

  return (
    <Panel aria-label="Grant event access">
      <PanelHeader title="Grant event access" breadcrumb />
      <PanelBody>
        <form
          class="pk-stack"
          aria-label="Grant event access"
          noValidate
          {...form.handlers}
          onSubmit={(event) => void handleAdd(event)}
        >
          {/* One `disabled` on the group rather than one per control: the
              picker is a child component that takes no disabled prop of its
              own. */}
          <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={adding}>
            <Field
              label="Person"
              required
              help="Search by name or email for someone the portal knows."
              {...form.of("userId")}
            >
              {(control) => (
                <UserPicker value={picked} onChange={setPicked} disabled={Boolean(person)} inputProps={control} />
              )}
            </Field>
            <Field label="Role" {...form.of("role")}>
              {(control) => (
                <Select
                  {...control}
                  name="role"
                  value={role}
                  onChange={(e) => setRole(e.currentTarget.value as EventTeamRole)}
                >
                  {EVENT_TEAM_ROLES.map((option) => (
                    <option key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Expires"
              help={`Leave empty for an assignment that never expires. Times are in ${timeZone}.`}
              {...form.of("expiresAt")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="expiresAt"
                  type="datetime-local"
                  value={expiresAt}
                  onInput={(e) => setExpiresAt(e.currentTarget.value)}
                />
              )}
            </Field>
          </fieldset>
          {error && <Alert tone="danger">{error}</Alert>}
          <div class="pk-cluster">
            <Button type="submit" variant="primary" loading={adding} disabled={adding}>
              {adding ? "Adding…" : "Grant event access"}
            </Button>
            <ButtonLink href={usePortalHashLocation.hrefs(teamPath)} variant="ghost">
              Cancel
            </ButtonLink>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
