import { useState } from "preact/hooks";
import {
  organizationContactDetailsResponseSchema,
  organizationContactDetailsUpdateSchema,
  type OrganizationContactDetails,
} from "../../../../shared/schemas/organization-contact-details";
import { countryName } from "../../../../shared/countries";
import { CountrySelect } from "../../../components/CountrySelect";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { useContractForm } from "../../../hooks/useContractForm";
import { useData } from "../../../hooks/useData";
import { getJson, putJson } from "../../../shared/api-client";
import { Alert } from "../../../ui/Alert";
import { Button } from "../../../ui/Button";
import { DescriptionList } from "../../../ui/DescriptionList";
import { Dialog } from "../../../ui/Dialog";
import { EmptyState } from "../../../ui/EmptyState";
import { Field } from "../../../ui/Field";
import { Menu } from "../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { Spinner } from "../../../ui/Spinner";
import { TextInput, Textarea } from "../../../ui/TextControl";
import { profile } from "../state";
import { toast } from "../ui";

function contactDetailsPath(organizationId: string) {
  return `/api/v1/organizations/${encodeURIComponent(organizationId)}/contacts/details`;
}

function ContactDetailsEditor({
  organizationId,
  details,
  onSaved,
  onCancel,
}: {
  organizationId: string;
  details: OrganizationContactDetails | null;
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState({
    email: details?.email ?? "",
    phone: details?.phone ?? "",
    lines: details?.postalAddress?.lines.join("\n") ?? "",
    city: details?.postalAddress?.city ?? "",
    region: details?.postalAddress?.region ?? "",
    postalCode: details?.postalAddress?.postalCode ?? "",
    countryCode: details?.countryCode ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(organizationContactDetailsUpdateSchema, {
    email: draft.email.trim() || null,
    phone: draft.phone.trim() || null,
    postalAddress: {
      lines: draft.lines
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
      city: draft.city.trim() || null,
      region: draft.region.trim() || null,
      postalCode: draft.postalCode.trim() || null,
    },
    countryCode: draft.countryCode || null,
    revision: details?.revision ?? 0,
  });
  const update = (field: keyof typeof draft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  async function save() {
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.formMessage ?? "");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await putJson(contactDetailsPath(organizationId), checked.data, organizationContactDetailsResponseSchema);
      toast("Contact details saved", "success");
      await onSaved();
    } catch (caught) {
      setError(form.refuse(caught));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      title="Private contact details"
      closeLabel="Close contact details"
      description="Only staff and your organization's contacts can see these details."
      confirmLabel={saving ? "Saving…" : "Save contact details"}
      confirmDisabled={saving}
      onConfirm={() => void save()}
      onCancel={() => {
        if (!saving) onCancel();
      }}
    >
      <form
        noValidate
        {...form.handlers}
        class="pk-stack"
        aria-busy={saving}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <Field
          label="Organization email"
          help="We send membership notices here when your organization has no primary or secondary contact."
          {...form.of("email")}
        >
          {(control) => (
            <TextInput
              {...control}
              name="email"
              type="email"
              autoComplete="email"
              value={draft.email}
              disabled={saving}
              onInput={(event) => update("email", event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="Phone" {...form.of("phone")}>
          {(control) => (
            <TextInput
              {...control}
              name="phone"
              type="tel"
              autoComplete="tel"
              value={draft.phone}
              disabled={saving}
              onInput={(event) => update("phone", event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="Street address" {...form.ofGroup("postalAddress.lines")}>
          {(control) => (
            <Textarea
              {...control}
              name="postalAddress.lines"
              autoComplete="street-address"
              rows={3}
              value={draft.lines}
              disabled={saving}
              onInput={(event) => update("lines", event.currentTarget.value)}
            />
          )}
        </Field>
        {(
          [
            ["city", "City", "address-level2"],
            ["region", "State or region", "address-level1"],
            ["postalCode", "Postal code", "postal-code"],
          ] as const
        ).map(([field, label, autoComplete]) => (
          <Field key={field} label={label} {...form.of(`postalAddress.${field}`)}>
            {(control) => (
              <TextInput
                {...control}
                name={`postalAddress.${field}`}
                autoComplete={autoComplete}
                value={draft[field]}
                disabled={saving}
                onInput={(event) => update(field, event.currentTarget.value)}
              />
            )}
          </Field>
        ))}
        <Field label="Country" {...form.of("countryCode")}>
          {(control) => (
            <CountrySelect
              {...control}
              name="countryCode"
              value={draft.countryCode}
              disabled={saving}
              onChange={(value) => update("countryCode", value)}
            />
          )}
        </Field>
      </form>
    </Dialog>
  );
}

function ContactDetailsPanel({ organizationId, canWrite }: { organizationId: string; canWrite: boolean }) {
  const { data, loading, error, reload } = useData(
    () => getJson(contactDetailsPath(organizationId), organizationContactDetailsResponseSchema),
    [organizationId],
  );
  const [editing, setEditing] = useState(false);
  const details = data?.contactDetails;
  const empty = !details || (!details.email && !details.phone && !details.postalAddress && !details.countryCode);
  return (
    <Panel aria-label="Private contact details">
      <PanelHeader
        title="Private contact details"
        menu={
          canWrite && data && !empty ? (
            <Menu
              label="Private contact details actions"
              align="end"
              items={[{ id: "edit", label: "Edit contact details…", onSelect: () => setEditing(true) }]}
            />
          ) : undefined
        }
      />
      <PanelBody>
        <div class="pk-stack">
          <p class="pk-small pk-muted">Not published</p>
          {loading && <Spinner label="Loading contact details…" />}
          {error && <ErrorAlert error={error} />}
          {!loading &&
            data &&
            !error &&
            (empty ? (
              <EmptyState title="No contact details yet">
                {canWrite && <Button onClick={() => setEditing(true)}>Add contact details</Button>}
              </EmptyState>
            ) : (
              <DescriptionList
                density="compact"
                items={[
                  { term: "Email", value: details?.email },
                  { term: "Phone", value: details?.phone },
                  {
                    term: "Postal address",
                    value:
                      details?.postalAddress &&
                      [
                        ...details.postalAddress.lines,
                        details.postalAddress.city,
                        details.postalAddress.region,
                        details.postalAddress.postalCode,
                      ]
                        .filter(Boolean)
                        .map((line, index) => <div key={index}>{line}</div>),
                  },
                  { term: "Country", value: details?.countryCode ? countryName(details.countryCode) : null },
                ]}
              />
            ))}
        </div>
      </PanelBody>
      {editing && canWrite && data && (
        <ContactDetailsEditor
          organizationId={organizationId}
          details={data.contactDetails}
          onSaved={async () => {
            setEditing(false);
            await reload();
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </Panel>
  );
}

/** Discard private cached data and drafts whenever the acting identity changes. */
export function OrganizationPrivateContactDetails(props: { organizationId: string; canWrite: boolean }) {
  return <ContactDetailsPanel key={`${props.organizationId}:${profile.value?.identityId ?? "staff"}`} {...props} />;
}
