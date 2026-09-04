/**
 * Setting what a member is open to.
 *
 * Availability is the one part of a profile that is career-sensitive: it says
 * somebody may be leaving their job. So it is edited behind an explicit
 * disclosure rather than sitting open on the record, and it carries its own
 * audience control — `private` keeps it from every other member, and the read
 * model then withholds it in a way that is indistinguishable from never having
 * been set.
 */
import { useState } from "preact/hooks";

import {
  memberAvailabilityResponseSchema,
  memberAvailabilityUpdateSchema,
  type MemberAvailability,
} from "../../../../../shared/schemas/member-profile";
import { useContractForm } from "../../../../hooks/useContractForm";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { putJson } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";
import { toast } from "../../ui";

export interface AvailabilityDraft {
  openToEmployment: boolean;
  openToContract: boolean;
  rolesSought: string;
  servicesOffered: string;
  note: string;
  availableFrom: string;
  visibility: "members" | "private";
}

export function draftFrom(availability: MemberAvailability | null): AvailabilityDraft {
  return {
    openToEmployment: availability?.openToEmployment ?? false,
    openToContract: availability?.openToContract ?? false,
    rolesSought: availability?.rolesSought ?? "",
    servicesOffered: availability?.servicesOffered ?? "",
    note: availability?.note ?? "",
    availableFrom: availability?.availableFrom ?? "",
    visibility: availability?.visibility ?? "members",
  };
}

/** Empty strings are "not stated", which the contract expresses as null. */
function payloadFrom(draft: AvailabilityDraft) {
  return {
    openToEmployment: draft.openToEmployment,
    openToContract: draft.openToContract,
    rolesSought: draft.rolesSought.trim() || null,
    servicesOffered: draft.servicesOffered.trim() || null,
    note: draft.note.trim() || null,
    availableFrom: draft.availableFrom.trim() || null,
    visibility: draft.visibility,
  };
}

export function UserAvailabilityEditor({
  userId,
  availability,
  onSaved,
}: {
  userId: string;
  availability: MemberAvailability | null;
  onSaved: (next: MemberAvailability | null) => void;
}) {
  const [draft, setDraft] = useState<AvailabilityDraft>(() => draftFrom(availability));
  const [saving, setSaving] = useState(false);
  const form = useContractForm(memberAvailabilityUpdateSchema, payloadFrom(draft));

  const set = <K extends keyof AvailabilityDraft>(key: K, value: AvailabilityDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  async function save(event: Event) {
    event.preventDefault();
    const { data, message } = form.submit();
    if (!data) {
      toast(message, "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await putJson(
        `/api/v1/users/${encodeURIComponent(userId)}/availability`,
        data,
        memberAvailabilityResponseSchema,
      );
      onSaved(saved.availability);
      toast("Availability saved", "success");
    } catch (cause) {
      toast(form.refuse(cause) || friendlyErrorMessage((cause as Error).message), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    // `noValidate`: the contract speaks for the form, so the browser's own
    // bubble never gets in ahead of it.
    <form class="pk-stack" noValidate onSubmit={(event) => void save(event)} {...form.handlers}>
      <Checkbox
        label="Open to employment"
        checked={draft.openToEmployment}
        onChange={(event) => {
          set("openToEmployment", (event.currentTarget as HTMLInputElement).checked);
        }}
      />
      <Checkbox
        label="Available for contract work"
        checked={draft.openToContract}
        onChange={(event) => {
          set("openToContract", (event.currentTarget as HTMLInputElement).checked);
        }}
      />

      {/* Two fields, because the two states are answered differently: someone
          open to employment names the roles they want, someone available for
          contract work names the services they sell. Separated by commas so
          the record can list them rather than print one run-on line. */}
      <Field
        label="Roles sought"
        help="Separate them with commas. Shown under “Open to employment”."
        {...form.of("rolesSought")}
      >
        {(control) => (
          <TextInput
            {...control}
            value={draft.rolesSought}
            placeholder="Principal architect, Head of trust services, Standards lead"
            onInput={(event) => {
              set("rolesSought", (event.currentTarget as HTMLInputElement).value);
            }}
          />
        )}
      </Field>

      <Field
        label="Services offered"
        help="Separate them with commas. Shown under “Available for contract work”."
        {...form.of("servicesOffered")}
      >
        {(control) => (
          <TextInput
            {...control}
            value={draft.servicesOffered}
            placeholder="PKI design review, eIDAS conformance, Training"
            onInput={(event) => {
              set("servicesOffered", (event.currentTarget as HTMLInputElement).value);
            }}
          />
        )}
      </Field>

      <Field
        label="Note"
        help="A second, quieter line: location, notice period, how to reach you."
        {...form.of("note")}
      >
        {(control) => (
          <TextInput
            {...control}
            value={draft.note}
            placeholder="Remote or hybrid in the EU"
            onInput={(event) => {
              set("note", (event.currentTarget as HTMLInputElement).value);
            }}
          />
        )}
      </Field>

      <Field
        label="Available from"
        help="A date, not an instant — it never shifts by a timezone."
        {...form.of("availableFrom")}
      >
        {(control) => (
          <TextInput
            {...control}
            type="date"
            value={draft.availableFrom}
            onInput={(event) => {
              set("availableFrom", (event.currentTarget as HTMLInputElement).value);
            }}
          />
        )}
      </Field>

      <Field label="Who can see this" {...form.of("visibility")}>
        {(control) => (
          <Select
            {...control}
            value={draft.visibility}
            onChange={(event) => {
              set("visibility", (event.currentTarget as HTMLSelectElement).value as AvailabilityDraft["visibility"]);
            }}
          >
            <option value="members">Signed-in members</option>
            <option value="private">Nobody — keep this to myself</option>
          </Select>
        )}
      </Field>

      <div class="pk-cluster">
        <Button type="submit" variant="primary" size="sm" loading={saving}>
          {saving ? "Saving…" : "Save availability"}
        </Button>
      </div>
    </form>
  );
}
