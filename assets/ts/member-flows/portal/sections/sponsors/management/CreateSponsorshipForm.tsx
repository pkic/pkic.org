import { useState } from "preact/hooks";
import type { z } from "zod";
import { postJson } from "../../../../../shared/api-client";
import { normalizeValidation } from "../../../../../shared/form/validation-map";
import {
  SPONSOR_TYPES,
  sponsorshipCreateSchema,
  sponsorshipResponseSchema,
} from "../../../../../../shared/schemas/sponsorship-management";
import {
  organizationsListResponseSchema,
  type OrganizationSummary,
} from "../../../../../../shared/schemas/organization-management";
import { eventsListResponseSchema } from "../../../../../../shared/schemas/event-management";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { ServerSearchSelect } from "../../../../../components/ServerSearchSelect";
import type { ServerCatalog } from "../../../../../shared/server-catalog";
import { Alert } from "../../../../../ui/Alert";
import { Button } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Panel, PanelBody } from "../../../../../ui/Panel";
import { Select, TextInput } from "../../../../../ui/TextControl";
import { portalHasGlobalPermission } from "../../../shell/portal-navigation";
import { portalSession } from "../../../state";
import { fmtDate, toast } from "../../../ui";
// `pk-mono` is written here as a class name rather than reached through a
// component, so this module has to pull its stylesheet into its own chunk.
import "../../../../../ui/Content.css";

interface CreateDraft {
  sponsorType: (typeof SPONSOR_TYPES)[number];
  organizationId: string;
  eventId: string;
  nonMemberName: string;
  contactName: string;
  contactEmail: string;
  tier: string;
}

/**
 * What each sponsor type is called in the interface. The stored values stay
 * the schema's (`consortium`, `event`); this only decides how they read.
 */
const SPONSOR_TYPE_LABELS: Record<(typeof SPONSOR_TYPES)[number], string> = {
  consortium: "Consortium sponsor",
  event: "Event sponsor",
};

/**
 * Member organizations, searched where they already live: the canonical
 * organization directory list, one bounded server page at a time.
 */
const memberOrganizationCatalog: ServerCatalog<OrganizationSummary, z.infer<typeof organizationsListResponseSchema>> = {
  endpoint: "/api/v1/organizations",
  responseSchema: organizationsListResponseSchema,
  resolveItems: (response) => response.organizations,
  resolvePage: (response) => response.page,
  itemKey: (organization) => organization.id,
  itemLabel: (organization) => organization.name,
  sort: "name",
};

/** One row of whichever projection the canonical events list returns for this caller. */
type SponsorableEvent = z.infer<typeof eventsListResponseSchema>["events"][number];

function sponsorableEventLabel(event: SponsorableEvent): string {
  return event.startsAt ? `${event.name} — ${fmtDate(event.startsAt)}` : event.name;
}

/**
 * The canonical events list the rest of the portal queries. Newest first,
 * because a sponsorship being opened is almost always for an upcoming or
 * recent event rather than an archival one.
 */
const sponsorableEventCatalog: ServerCatalog<SponsorableEvent, z.infer<typeof eventsListResponseSchema>> = {
  endpoint: "/api/v1/events",
  responseSchema: eventsListResponseSchema,
  resolveItems: (response) => response.events,
  resolvePage: (response) => response.page,
  itemKey: (event) => event.id,
  itemLabel: sponsorableEventLabel,
  sort: "-starts_at",
};

function emptyCreateDraft(): CreateDraft {
  return {
    sponsorType: "consortium",
    organizationId: "",
    eventId: "",
    nonMemberName: "",
    contactName: "",
    contactEmail: "",
    tier: "",
  };
}

export function CreateSponsorshipForm({
  onCreated,
  onCancel,
  showCancel = true,
}: {
  onCreated: () => void;
  onCancel: () => void;
  showCancel?: boolean;
}) {
  const [draft, setDraft] = useState<CreateDraft>(emptyCreateDraft());
  // What the chosen organization and event are called, so the pickers can
  // read the selection back after a sponsor-type round trip remounts them.
  // The ids alone would otherwise resurface as raw UUIDs in the closed input.
  const [organizationLabel, setOrganizationLabel] = useState<string | undefined>(undefined);
  const [eventLabel, setEventLabel] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // The organization directory list refuses callers without this permission,
  // so the picker would open onto nothing but an error. Those accounts keep
  // the raw id input instead of a broken search. The events list has no such
  // gate — it serves every authenticated caller their visible rows — so the
  // event picker needs no fallback.
  const canPickOrganizations = portalHasGlobalPermission(portalSession.value, "organizations:read");

  /** The invalid state and message for one contract field, if it has any. */
  function fieldFor(key: string): { state: "invalid"; message: string } | Record<string, never> {
    const message = fieldErrors[key];
    return message ? { state: "invalid", message } : {};
  }

  function showRefusal(cause: unknown): void {
    // Stated in the form the reader is standing in, rather than only in a
    // toast that has faded by the time they look for the reason, and pinned
    // to the exact fields the contract refused where the refusal names them.
    // The draft survives, so a refusal is a retry rather than a restart.
    const refusal = normalizeValidation(cause);
    setFieldErrors(refusal.fields);
    setError(new Error(refusal.globalMessage));
  }

  async function submit(e: Event) {
    e.preventDefault();
    const shared = {
      sponsorType: draft.sponsorType,
      tier: draft.tier.trim() || null,
      contactName: draft.contactName.trim() || null,
      contactEmail: draft.contactEmail.trim() || null,
    };
    // Only the fields the chosen sponsor type offers travel. The draft keeps
    // every value across a type switch so nothing typed is lost, but a value
    // whose control the form no longer shows must not ride along invisibly —
    // it once made every sponsor type fail with an unexplained "Invalid
    // request" after one bad organization id was typed (issue #22).
    const payload =
      draft.sponsorType === "consortium"
        ? { ...shared, organizationId: draft.organizationId.trim() || null }
        : { ...shared, eventId: draft.eventId.trim() || null, nonMemberName: draft.nonMemberName.trim() || null };

    // Parsed through the canonical contract before it is sent, so a value the
    // server would refuse is named on its own field without a round trip.
    const parsed = sponsorshipCreateSchema.safeParse(payload);
    if (!parsed.success) {
      showRefusal(parsed.error);
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      await postJson("/api/v1/sponsors", parsed.data, sponsorshipResponseSchema);
      toast("Sponsorship created", "success");
      onCreated();
    } catch (cause) {
      showRefusal(cause);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="pk pk-stack" aria-label="Create sponsorship" onSubmit={(e) => void submit(e)}>
      <Panel>
        <PanelBody class="pk-stack">
          <ErrorAlert error={error} />
          {/* One disabled fieldset takes every control out of play while the
              create is in flight. The submit and cancel controls stay outside
              it, so the button the reader just pressed keeps focus instead of
              being disabled from under them. */}
          <fieldset class="pk-fieldset pk-stack" disabled={saving}>
            <div class="pk-grid pk-grid--tight">
              <Field label="Type">
                {(control) => (
                  <Select
                    {...control}
                    value={draft.sponsorType}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        sponsorType: (e.target as HTMLSelectElement).value as CreateDraft["sponsorType"],
                      }))
                    }
                  >
                    {SPONSOR_TYPES.map((t) => (
                      <option value={t} key={t}>
                        {SPONSOR_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {draft.sponsorType === "consortium" ? (
                canPickOrganizations ? (
                  <div class="pk-stack pk-stack--tight">
                    <Field label="Member organization">
                      {(control) => (
                        <ServerSearchSelect
                          {...control}
                          searchLabel="Member organization"
                          catalog={memberOrganizationCatalog}
                          value={draft.organizationId || null}
                          selectedLabel={organizationLabel}
                          allowEmpty={false}
                          searchPlaceholder="Search member organizations…"
                          onChange={(organization) => {
                            setOrganizationLabel(organization?.name);
                            setDraft((d) => ({ ...d, organizationId: organization?.id ?? "" }));
                          }}
                        />
                      )}
                    </Field>
                    {/* The picker draws no message slot of its own, so the
                        contract's refusal — always "an organization is
                        required" here, since picking can't produce a bad id —
                        is announced right under the control it names. */}
                    {fieldErrors.organizationId && <Alert tone="danger">{fieldErrors.organizationId}</Alert>}
                  </div>
                ) : (
                  <Field
                    label="Organization ID"
                    required
                    help="A consortium sponsorship always names a member organization."
                    {...fieldFor("organizationId")}
                  >
                    {(control) => (
                      <TextInput
                        {...control}
                        class="pk-mono"
                        value={draft.organizationId}
                        onInput={(e) =>
                          setDraft((d) => ({ ...d, organizationId: (e.target as HTMLInputElement).value }))
                        }
                      />
                    )}
                  </Field>
                )
              ) : (
                <>
                  <div class="pk-stack pk-stack--tight">
                    <Field label="Event">
                      {(control) => (
                        <ServerSearchSelect
                          {...control}
                          searchLabel="Event"
                          catalog={sponsorableEventCatalog}
                          value={draft.eventId || null}
                          selectedLabel={eventLabel}
                          placeholder="No linked event"
                          searchPlaceholder="Search events…"
                          onChange={(event) => {
                            setEventLabel(event ? sponsorableEventLabel(event) : undefined);
                            setDraft((d) => ({ ...d, eventId: event?.id ?? "" }));
                          }}
                        />
                      )}
                    </Field>
                    {fieldErrors.eventId && <Alert tone="danger">{fieldErrors.eventId}</Alert>}
                  </div>
                  <Field label="Non-member name" {...fieldFor("nonMemberName")}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={draft.nonMemberName}
                        onInput={(e) =>
                          setDraft((d) => ({ ...d, nonMemberName: (e.target as HTMLInputElement).value }))
                        }
                      />
                    )}
                  </Field>
                </>
              )}

              <Field label="Tier" {...fieldFor("tier")}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={draft.tier}
                    onInput={(e) => setDraft((d) => ({ ...d, tier: (e.target as HTMLInputElement).value }))}
                  />
                )}
              </Field>
              <Field label="Contact name" {...fieldFor("contactName")}>
                {(control) => (
                  <TextInput
                    {...control}
                    value={draft.contactName}
                    onInput={(e) => setDraft((d) => ({ ...d, contactName: (e.target as HTMLInputElement).value }))}
                  />
                )}
              </Field>
              <Field label="Contact email" {...fieldFor("contactEmail")}>
                {(control) => (
                  <TextInput
                    {...control}
                    type="email"
                    value={draft.contactEmail}
                    onInput={(e) => setDraft((d) => ({ ...d, contactEmail: (e.target as HTMLInputElement).value }))}
                  />
                )}
              </Field>
            </div>
          </fieldset>

          <div class="pk-cluster">
            <Button type="submit" variant="primary" size="sm" loading={saving}>
              Create
            </Button>
            {showCancel && (
              <Button type="button" size="sm" disabled={saving} onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </PanelBody>
      </Panel>
    </form>
  );
}
