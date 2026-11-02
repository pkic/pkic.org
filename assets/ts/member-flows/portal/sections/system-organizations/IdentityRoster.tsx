import { useRef, useState } from "preact/hooks";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { identityCreateSchema, identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { EmptyState } from "../../../../ui/EmptyState";
import { FormActions } from "../../../../components/FormActions";
import type { ApiTableActions } from "../../../../components/ApiDataTable";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { postJson } from "../../../../shared/api-client";
import { useContractForm, type ContractForm, type FieldPresentation } from "../../../../hooks/useContractForm";
import { ORGANIZATION_JOB_TITLE_COPY } from "../../../../../shared/email-first-copy";
import type { z } from "zod";
import { Field } from "../../../../ui/Field";
import { TextInput } from "../../../../ui/TextControl";
import { ActingIdentityDirectory } from "../OrganizationIdentityDirectory";
import { toast } from "../../ui";

/** The job title every organization identity is created with: the contract's own field, required. */
function JobTitleField({
  value,
  onChange,
  presentation,
}: {
  value: string;
  onChange: (value: string) => void;
  presentation: FieldPresentation;
}) {
  return (
    <Field
      label={ORGANIZATION_JOB_TITLE_COPY.label}
      help="Their role at this organization, shown with their name."
      required
      {...presentation}
    >
      {(control) => (
        <TextInput
          {...control}
          name="jobTitle"
          value={value}
          onInput={(event) => onChange(event.currentTarget.value)}
        />
      )}
    </Field>
  );
}

/** Creates the identity through the route's contract; a refusal lands on the fields it names. */
async function createIdentity(
  organizationId: string,
  form: ContractForm<z.output<typeof identityCreateSchema>>,
  setError: (message: string) => void,
): Promise<boolean> {
  const checked = form.submit();
  if (!checked.data) {
    setError(checked.formMessage ?? "");
    return false;
  }
  try {
    await postJson(
      `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
      checked.data,
      identityMutationResponseSchema,
    );
    toast("Identity invitation sent", "success");
    return true;
  } catch (caught) {
    const message = form.refuse(caught);
    setError(message);
    toast(message, "error");
    return false;
  }
}

/** Associate a user the system already knows without re-entering their identity. */
function LinkExistingUserForm({
  organizationId,
  onAdded,
  onCancel,
}: {
  organizationId: string;
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [user, setUser] = useState<PickedUser | null>(null);
  const [jobTitle, setJobTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(identityCreateSchema, {
    userReference: "existing_user",
    userId: user?.id,
    jobTitle,
    activation: { mode: "invitation" },
    showOnOrganizationProfile: true,
  });

  async function submit(event: Event) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError("");
    const added = await createIdentity(organizationId, form, setError);
    setBusy(false);
    if (added) await onAdded();
  }

  return (
    <form noValidate class="pk-stack pk-stack--snug" {...form.handlers} onSubmit={submit}>
      {/*
       * `UserPicker` names its own search box, so the heading beside it used to
       * be a `<label>` pointing at nothing. A `<legend>` names the group the
       * control belongs to, which is a relationship the markup can express.
       */}
      <fieldset class="pk-fieldset pk-field">
        <legend class="pk-field__label">Existing user</legend>
        <UserPicker value={user} onChange={setUser} disabled={busy} />
      </fieldset>
      <JobTitleField value={jobTitle} onChange={setJobTitle} presentation={form.of("jobTitle")} />
      {/*
       * `busy` used to double as "nothing is picked yet", which labeled an
       * idle button "Linking…". The two are separate now: `disabled` blocks the
       * submit, `busy` says a request is in flight. A failure is a `danger`
       * status, so it is announced rather than left as gray text.
       */}
      <FormActions
        submitLabel="Link"
        busyLabel="Linking…"
        busy={busy}
        disabled={!user}
        onCancel={onCancel}
        status={error || undefined}
        statusVariant="danger"
      />
    </form>
  );
}

function AddIdentityForm({
  organizationId,
  onAdded,
  onCancel,
}: {
  organizationId: string;
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(identityCreateSchema, {
    userReference: "email",
    name: name.trim(),
    email: email.trim(),
    jobTitle,
    ...(links.length > 0 ? { links } : {}),
    showOnOrganizationProfile: true,
  });

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const added = await createIdentity(organizationId, form, setError);
    setBusy(false);
    if (added) await onAdded();
  }

  return (
    <form noValidate class="pk-stack pk-stack--snug" {...form.handlers} onSubmit={submit}>
      {/*
       * One `disabled` fieldset instead of a `disabled` prop repeated on every
       * control — including `ProfileLinksInput`, which has no such prop to
       * take. The legend also names the group, which is what tells "Name" and
       * "Email" apart from the organization profile form above it on this page.
       */}
      <fieldset class="pk-fieldset pk-field" disabled={busy}>
        <legend class="pk-field__label">New person</legend>
        <div class="pk-stack pk-stack--snug">
          <div class="pk-grid pk-grid--tight">
            <Field label="Name" required {...form.of("name")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="name"
                  value={name}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              )}
            </Field>
            <Field label="Email" required {...form.of("email")}>
              {(control) => (
                <TextInput
                  {...control}
                  type="email"
                  name="email"
                  value={email}
                  onInput={(event) => setEmail(event.currentTarget.value)}
                />
              )}
            </Field>
            <JobTitleField value={jobTitle} onChange={setJobTitle} presentation={form.of("jobTitle")} />
          </div>
          {/* The widget names itself now, so it needs no fieldset around it to
              borrow a label from. */}
          <ProfileLinksInput fieldName="identity.links" label="Profile links" value={links} onChange={setLinks} />
        </div>
      </fieldset>
      <FormActions
        submitLabel="Add"
        busyLabel="Adding…"
        busy={busy}
        onCancel={onCancel}
        status={error || undefined}
        statusVariant="danger"
      />
    </form>
  );
}

export function IdentityRoster({
  organization,
  canManageIdentities,
  onChanged,
}: {
  organization: OrganizationDetail;
  canManageIdentities: boolean;
  onChanged: () => Promise<void>;
}) {
  const [addMode, setAddMode] = useState<"closed" | "link" | "email">("closed");
  const directoryRef = useRef<ApiTableActions | null>(null);
  const closeAdd = () => setAddMode("closed");
  const afterAdded = async () => {
    closeAdd();
    await onChanged();
    await directoryRef.current?.reload();
  };

  const createAction = canManageIdentities
    ? {
        label: "Add representative",
        items: [
          { id: "link", label: "Link an existing user…", onSelect: () => setAddMode("link") },
          { id: "email", label: "Add a new person…", onSelect: () => setAddMode("email") },
        ],
      }
    : undefined;
  const inset =
    addMode === "link" && canManageIdentities ? (
      <LinkExistingUserForm organizationId={organization.id} onAdded={afterAdded} onCancel={closeAdd} />
    ) : addMode === "email" && canManageIdentities ? (
      <AddIdentityForm organizationId={organization.id} onAdded={afterAdded} onCancel={closeAdd} />
    ) : undefined;

  return (
    <ActingIdentityDirectory
      caption="Representatives"
      organizationId={organization.id}
      activeIdentities={organization.identities}
      canManage={canManageIdentities}
      onChanged={onChanged}
      actionsRef={directoryRef}
      createAction={createAction}
      inset={inset}
      empty={
        <EmptyState
          title="No representatives yet"
          body={
            canManageIdentities
              ? "A representative is a person who acts for this organization. Use Add representative above to invite the first one."
              : "A representative is a person who acts for this organization. Nobody does yet."
          }
        />
      }
    />
  );
}
