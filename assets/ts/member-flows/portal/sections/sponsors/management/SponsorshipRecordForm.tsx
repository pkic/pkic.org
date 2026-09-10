/**
 * Correcting a sponsorship's own details.
 *
 * An inquiry arrives with whatever the sender typed into a public form, and
 * everything about it can turn out to be wrong or to change during a
 * negotiation: the tier they meant, who at the company is handling it, how the
 * company spells its own name. Until issue #30 the only fields staff could
 * change afterwards were the ones the pipeline needed for its own automation —
 * assigned staff, renewal date, notes — so a wrong tier or a departed contact
 * meant re-entering the sponsorship from scratch.
 *
 * The sponsor's name and website are here only when there is no member
 * organization behind the sponsorship; a member's name lives on the
 * organization, and the server refuses a patch that says otherwise.
 */
import { useState } from "preact/hooks";
import { patchJson } from "../../../../../shared/api-client";
import { sponsorshipResponseSchema, type Sponsorship } from "../../../../../../shared/schemas/sponsorship-management";
import { useSponsorshipTierCatalog } from "../../../../../hooks/useSponsorshipTierCatalog";
import { Button } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Select, TextInput, Textarea } from "../../../../../ui/TextControl";
import { UserPicker, type PickedUser } from "../../../../../components/UserPicker";
import { toast } from "../../../ui";

/** The tiers on offer, plus whatever this sponsorship already holds. */
function tierOptions(catalog: readonly string[], current: string | null): readonly string[] {
  // A tier withdrawn from sale keeps the sponsorships already sold under it,
  // so opening this form on one must not silently move it to another tier.
  return current && !catalog.includes(current) ? [current, ...catalog] : catalog;
}

export function SponsorshipRecordForm({
  sponsorship,
  onSaved,
}: {
  sponsorship: Sponsorship;
  /** Closing the form is the panel header's Edit/Cancel toggle, not a second control down here. */
  onSaved: () => Promise<void>;
}) {
  const [tier, setTier] = useState(sponsorship.tier ?? "");
  const [contactName, setContactName] = useState(sponsorship.contactName ?? "");
  const [contactEmail, setContactEmail] = useState(sponsorship.contactEmail ?? "");
  const [sponsorName, setSponsorName] = useState(sponsorship.nonMemberName ?? "");
  const [website, setWebsite] = useState(sponsorship.nonMemberWebsite ?? "");
  const [notes, setNotes] = useState(sponsorship.notes ?? "");
  const [renewalDate, setRenewalDate] = useState(sponsorship.renewalDate ?? "");
  const [assignedTo, setAssignedTo] = useState<PickedUser | null>(
    sponsorship.assignedToUserId
      ? { id: sponsorship.assignedToUserId, email: sponsorship.assignedToName ?? sponsorship.assignedToUserId }
      : null,
  );
  const [busy, setBusy] = useState(false);

  const tiers = tierOptions(useSponsorshipTierCatalog(sponsorship.sponsorType), sponsorship.tier);
  const isNonMember = !sponsorship.organizationId;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await patchJson(
        `/api/v1/sponsors/${encodeURIComponent(sponsorship.id)}`,
        {
          tier: tier || null,
          contactName: contactName.trim() || null,
          contactEmail: contactEmail.trim() || null,
          notes: notes.trim() || null,
          renewalDate: renewalDate.trim() || null,
          assignedToUserId: assignedTo?.id ?? null,
          ...(isNonMember
            ? { nonMemberName: sponsorName.trim() || null, nonMemberWebsite: website.trim() || null }
            : {}),
        },
        sponsorshipResponseSchema,
      );
      toast("Saved", "success");
      await onSaved();
    } catch (error) {
      toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      class="pk-stack pk-stack--snug"
      aria-label="Edit sponsorship record"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {isNonMember && (
        <div class="pk-grid pk-grid--tight">
          <Field label="Sponsor name">
            {(control) => (
              <TextInput
                {...control}
                value={sponsorName}
                disabled={busy}
                onInput={(e) => setSponsorName((e.target as HTMLInputElement).value)}
              />
            )}
          </Field>
          <Field label="Website">
            {(control) => (
              <TextInput
                {...control}
                type="url"
                value={website}
                disabled={busy}
                onInput={(e) => setWebsite((e.target as HTMLInputElement).value)}
              />
            )}
          </Field>
        </div>
      )}
      <div class="pk-grid pk-grid--tight">
        {/* The tier catalog, not a text box: a tier is a row with a price
            beside it, and "Platinum " is not one of them. */}
        <Field label="Tier">
          {(control) => (
            <Select
              {...control}
              value={tier}
              disabled={busy}
              onChange={(e) => setTier((e.target as HTMLSelectElement).value)}
            >
              <option value="">No tier yet</option>
              {tiers.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Renewal date">
          {(control) => (
            <TextInput
              {...control}
              type="date"
              value={renewalDate}
              disabled={busy}
              onInput={(e) => setRenewalDate((e.target as HTMLInputElement).value)}
            />
          )}
        </Field>
      </div>
      <div class="pk-grid pk-grid--tight">
        <Field label="Contact name">
          {(control) => (
            <TextInput
              {...control}
              value={contactName}
              disabled={busy}
              onInput={(e) => setContactName((e.target as HTMLInputElement).value)}
            />
          )}
        </Field>
        <Field label="Contact email">
          {(control) => (
            <TextInput
              {...control}
              type="email"
              value={contactEmail}
              disabled={busy}
              onInput={(e) => setContactEmail((e.target as HTMLInputElement).value)}
            />
          )}
        </Field>
      </div>
      {/* A search-as-you-type picker: the record stores a user id, but nobody
          types a UUID. A fieldset legend names it, the way every composite
          picker is labelled, rather than a label with no single control to
          point its `for` at. */}
      <fieldset class="pk-fieldset pk-field">
        <legend class="pk-field__label">Assigned staff</legend>
        <UserPicker
          endpoint="/api/v1/permissions/subjects"
          value={assignedTo}
          disabled={busy}
          onChange={setAssignedTo}
        />
      </fieldset>
      <Field label="Notes">
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            value={notes}
            disabled={busy}
            onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
          />
        )}
      </Field>
      <div class="pk-cluster">
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
