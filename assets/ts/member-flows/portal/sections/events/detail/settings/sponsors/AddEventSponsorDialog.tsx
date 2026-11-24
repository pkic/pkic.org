/**
 * Adds a sponsor that supports this one event, such as a local company that
 * sponsors a single conference. The sponsor is recorded for PKIC to follow up;
 * no payment is asked for here.
 */
import { useState } from "preact/hooks";
import { postJson } from "../../../../../../../shared/api-client";
import {
  sponsorshipCreateSchema,
  sponsorshipResponseSchema,
} from "../../../../../../../../shared/schemas/sponsorship-management";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { useSponsorshipTierCatalog } from "../../../../../../../hooks/useSponsorshipTierCatalog";
import { Alert } from "../../../../../../../ui/Alert";
import { Dialog } from "../../../../../../../ui/Dialog";
import { Field } from "../../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../../ui/TextControl";

export function AddEventSponsorDialog({
  eventId,
  onClose,
  onAdded,
}: {
  eventId: string;
  onClose: () => void;
  onAdded: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [tier, setTier] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const tiers = useSponsorshipTierCatalog("event");
  const optional = (value: string) => value.trim() || null;
  const form = useContractForm(sponsorshipCreateSchema, {
    sponsorType: "event",
    eventId,
    nonMemberName: name,
    nonMemberWebsite: optional(website),
    tier: optional(tier),
    contactName: optional(contactName),
    contactEmail: optional(contactEmail),
  });

  async function add() {
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      await postJson("/api/v1/sponsors", checked.data, sponsorshipResponseSchema);
      await onAdded(name.trim());
    } catch (cause) {
      setError(form.refuse(cause));
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      title="Add event sponsor"
      closeLabel="Close dialog"
      description="For a sponsor of this event only. The sponsorship team contacts the sponsor about payment."
      confirmLabel="Add sponsor"
      confirmDisabled={saving}
      onConfirm={() => void add()}
      onCancel={() => {
        // A pending request finishes in this dialog, so its result never lands in a dialog opened after it.
        if (!saving) onClose();
      }}
    >
      <form
        noValidate
        class="pk-stack"
        {...form.handlers}
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          void add();
        }}
      >
        <Field {...form.of("nonMemberName")} label="Sponsor" required>
          {(control) => (
            <TextInput
              {...control}
              name="nonMemberName"
              value={name}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field {...form.of("nonMemberWebsite")} label="Website">
          {(control) => (
            <TextInput
              {...control}
              name="nonMemberWebsite"
              type="url"
              placeholder="https://example.com"
              value={website}
              onInput={(event) => setWebsite(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field {...form.of("tier")} label="Tier">
          {(control) => (
            <Select {...control} name="tier" value={tier} onChange={(event) => setTier(event.currentTarget.value)}>
              <option value="">No tier yet</option>
              {tiers.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field {...form.of("contactName")} label="Contact name">
          {(control) => (
            <TextInput
              {...control}
              name="contactName"
              value={contactName}
              onInput={(event) => setContactName(event.currentTarget.value)}
            />
          )}
        </Field>
        <Field {...form.of("contactEmail")} label="Contact email">
          {(control) => (
            <TextInput
              {...control}
              name="contactEmail"
              type="email"
              value={contactEmail}
              onInput={(event) => setContactEmail(event.currentTarget.value)}
            />
          )}
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </form>
    </Dialog>
  );
}
