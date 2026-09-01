import { useState } from "preact/hooks";
import { postJson } from "../../../../../shared/api-client";
import { SPONSOR_TYPES, sponsorshipResponseSchema } from "../../../../../../shared/schemas/sponsorship-management";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Button } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Panel, PanelBody } from "../../../../../ui/Panel";
import { Select, TextInput } from "../../../../../ui/TextControl";
import { toast } from "../../../ui";
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await postJson(
        "/api/v1/sponsors",
        {
          sponsorType: draft.sponsorType,
          organizationId: draft.organizationId.trim() || null,
          eventId: draft.eventId.trim() || null,
          nonMemberName: draft.nonMemberName.trim() || null,
          contactName: draft.contactName.trim() || null,
          contactEmail: draft.contactEmail.trim() || null,
          tier: draft.tier.trim() || null,
        },
        sponsorshipResponseSchema,
      );
      toast("Sponsorship created", "success");
      onCreated();
    } catch (cause) {
      // Stated in the form the reader is standing in, rather than only in a
      // toast that has faded by the time they look for the reason. The draft
      // survives, so a refusal is a retry rather than a restart.
      setError(cause instanceof Error ? cause : new Error("Could not create the sponsorship."));
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
                <Field
                  label="Organization ID"
                  required
                  help="A consortium sponsorship always names a member organization."
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      class="pk-mono"
                      value={draft.organizationId}
                      onInput={(e) => setDraft((d) => ({ ...d, organizationId: (e.target as HTMLInputElement).value }))}
                    />
                  )}
                </Field>
              ) : (
                <>
                  <Field label="Event ID">
                    {(control) => (
                      <TextInput
                        {...control}
                        class="pk-mono"
                        value={draft.eventId}
                        onInput={(e) => setDraft((d) => ({ ...d, eventId: (e.target as HTMLInputElement).value }))}
                      />
                    )}
                  </Field>
                  <Field label="Non-member name">
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

              <Field label="Tier">
                {(control) => (
                  <TextInput
                    {...control}
                    value={draft.tier}
                    onInput={(e) => setDraft((d) => ({ ...d, tier: (e.target as HTMLInputElement).value }))}
                  />
                )}
              </Field>
              <Field label="Contact name">
                {(control) => (
                  <TextInput
                    {...control}
                    value={draft.contactName}
                    onInput={(e) => setDraft((d) => ({ ...d, contactName: (e.target as HTMLInputElement).value }))}
                  />
                )}
              </Field>
              <Field label="Contact email">
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
