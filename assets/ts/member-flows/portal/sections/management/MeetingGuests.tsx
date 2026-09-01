import { useRef, useState } from "preact/hooks";
import {
  eventOccurrenceGuestInviteSchema,
  eventOccurrenceGuestResponseSchema,
  eventOccurrenceGuestsListResponseSchema,
  type EventOccurrence,
  type EventOccurrenceGuest,
} from "../../../../../shared/schemas/event-series";
import type { EventInviteWindow } from "../../../../../shared/schemas/event-invite-validity";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Badge } from "../../../../ui/Badge";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { TextInput } from "../../../../ui/TextControl";
import { deleteJson, postJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";
import { isoDateTimeValue, localDateTimeValue } from "./meeting-form-utils";

/**
 * The guest's standing, as a word first and a tone second. A revoked guest and
 * an expired one are not the same situation, and neither is legible from a
 * colour alone.
 */
function guestStanding(guest: EventOccurrenceGuest): { label: string; tone: "ok" | "danger" | "neutral" } {
  if (guest.revokedAt) return { label: "Revoked", tone: "danger" };
  return guest.active ? { label: "Active", tone: "ok" } : { label: "Inactive", tone: "neutral" };
}

export function MeetingGuests({
  base,
  occurrence,
  seriesInviteWindow,
  timeZone,
}: {
  base: string;
  occurrence: EventOccurrence;
  seriesInviteWindow: EventInviteWindow;
  timeZone: string;
}) {
  const actions = useRef<ApiTableActions | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => localDateTimeValue(occurrence.startsAt, timeZone));
  const [seriesWide, setSeriesWide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `${base}/occurrences/${encodeURIComponent(occurrence.id)}/guests`;
  const seriesWideId = `guest-series-wide-${occurrence.id}`;
  const effectiveWindow = seriesWide
    ? seriesInviteWindow
    : { startsAt: occurrence.startsAt, endsAt: occurrence.endsAt, timezone: timeZone };
  const maximumExpiry = effectiveWindow.endsAt ? localDateTimeValue(effectiveWindow.endsAt, timeZone) : undefined;

  async function invite(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const input = eventOccurrenceGuestInviteSchema.parse({
        email,
        name,
        affiliation: affiliation.trim() || null,
        expiresAt: isoDateTimeValue(expiresAt, timeZone),
        seriesWide,
      });
      await postJson(endpoint, input, eventOccurrenceGuestResponseSchema);
      setEmail("");
      setName("");
      setAffiliation("");
      toast("Guest eligibility added", "success");
      setShowAddForm(false);
      await actions.current?.reload();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(guest: EventOccurrenceGuest): Promise<void> {
    if (
      !(await confirmAction({
        title: `Revoke guest access for ${guest.name}?`,
        body: "This removes their eligibility for this occurrence and any active meeting access links.",
        consequences: [
          "Existing meeting access links for them stop working immediately",
          "They can be invited again later if needed",
        ],
        confirmLabel: "Revoke guest access",
      }))
    )
      return;
    try {
      await deleteJson(`${endpoint}/${encodeURIComponent(guest.id)}`, successResponseSchema);
      toast("Guest access revoked", "success");
      await actions.current?.reload();
    } catch (caught) {
      toast((caught as Error).message, "error");
    }
  }

  return (
    <div class="pk pk-stack">
      {showAddForm && (
        <Panel>
          <PanelHeader title="Add external guest eligibility" headingLevel={4}>
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </PanelHeader>
          <PanelBody>
            <form class="pk-stack" aria-label="Add external guest eligibility" onSubmit={(event) => void invite(event)}>
              {/* One `disabled` on the group rather than one per control: the
                  fields are rendered by a child component that takes no
                  disabled prop of its own. */}
              <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={saving}>
                <Field label="Email" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      type="email"
                      value={email}
                      onInput={(e) => setEmail(e.currentTarget.value)}
                    />
                  )}
                </Field>
                <Field label="Name" required>
                  {(control) => <TextInput {...control} value={name} onInput={(e) => setName(e.currentTarget.value)} />}
                </Field>
                <Field label="Affiliation">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={affiliation}
                      onInput={(e) => setAffiliation(e.currentTarget.value)}
                    />
                  )}
                </Field>
                <Field
                  label="Eligibility expires"
                  required
                  help={`Defaults to the ${seriesWide ? "series event" : "occurrence"} start and cannot extend beyond its end.`}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      type="datetime-local"
                      value={expiresAt}
                      max={maximumExpiry}
                      onInput={(e) => setExpiresAt(e.currentTarget.value)}
                    />
                  )}
                </Field>
              </fieldset>
              <label class="pk-check" for={seriesWideId}>
                <input
                  id={seriesWideId}
                  type="checkbox"
                  class="pk-check__input"
                  checked={seriesWide}
                  disabled={saving}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    setSeriesWide(checked);
                    const startsAt = checked ? seriesInviteWindow.startsAt : occurrence.startsAt;
                    if (startsAt) setExpiresAt(localDateTimeValue(startsAt, timeZone));
                  }}
                />
                <span class="pk-check__label">Eligible for every occurrence in this series</span>
              </label>
              {error && <ErrorAlert error={error} />}
              <div class="pk-cluster">
                <Button type="submit" variant="primary" size="sm" loading={saving}>
                  {saving ? "Adding…" : "Add guest"}
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>
      )}
      <ApiDataTable
        caption="External guests for this meeting occurrence"
        endpoint={endpoint}
        responseSchema={eventOccurrenceGuestsListResponseSchema}
        resolve={(response) => response.guests}
        resolvePage={(response) => response.page}
        paginate
        searchPlaceholder="Search guests…"
        initialSort="name"
        createAction={{ label: "Add guest", onSelect: () => setShowAddForm(true) }}
        actionsRef={actions}
        columns={[
          {
            header: "Guest",
            cell: (guest) => (
              <div class="pk-stack pk-stack--tight">
                <span class="pk-strong">{guest.name}</span>
                <span class="pk-small">{guest.email}</span>
              </div>
            ),
            sort: { asc: "name", desc: "-name" },
          },
          { header: "Affiliation", cell: (guest) => guest.affiliation ?? "—" },
          { header: "Scope", cell: (guest) => (guest.seriesWide ? "Series" : "Occurrence") },
          { header: "Expires", cell: (guest) => fmt(guest.expiresAt), width: "fit" },
          {
            header: "Status",
            cell: (guest) => {
              const standing = guestStanding(guest);
              return <Badge tone={standing.tone}>{standing.label}</Badge>;
            },
          },
          {
            header: "",
            className: "pk-end",
            cell: (guest) =>
              !guest.active ? null : (
                <RowActions
                  subject={guest.name}
                  actions={[{ id: "revoke", label: "Revoke", onSelect: () => void revoke(guest) }]}
                />
              ),
          },
        ]}
        empty={<EmptyState title="No guests yet" body="Add a guest to get started." />}
        rowKey={(guest) => guest.id}
      />
    </div>
  );
}
