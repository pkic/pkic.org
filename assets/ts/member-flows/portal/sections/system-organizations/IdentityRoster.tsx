import { useRef, useState } from "preact/hooks";
import type { OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { identityCreateSchema, identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { EmptyState } from "../../../../components/EmptyState";
import { FormActions } from "../../../../components/FormActions";
import type { ApiTableActions } from "../../../../components/ApiDataTable";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { postValidated } from "../../../../shared/api-client";
import { Button } from "../../../../ui/Button";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { TextInput } from "../../../../ui/TextControl";
import { ActingIdentityDirectory } from "../OrganizationIdentityDirectory";
import { toast } from "../../ui";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: Event) {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      await postValidated(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
        identityCreateSchema,
        {
          userReference: "existing_user",
          userId: user.id,
          activation: { mode: "invitation" },
          showOnOrganizationProfile: true,
        },
        identityMutationResponseSchema,
      );
      toast("Identity invitation sent", "success");
      await onAdded();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="pk-stack pk-stack--snug" onSubmit={submit}>
      {/*
       * `UserPicker` names its own search box, so the heading beside it used to
       * be a `<label>` pointing at nothing. A `<legend>` names the group the
       * control belongs to, which is a relationship the markup can express.
       */}
      <fieldset class="pk-fieldset pk-field">
        <legend class="pk-field__label">Existing user</legend>
        <UserPicker value={user} onChange={setUser} disabled={busy} />
      </fieldset>
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

  async function submit(event: Event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await postValidated(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
        identityCreateSchema,
        {
          userReference: "email",
          name: name.trim(),
          email: email.trim(),
          ...(jobTitle.trim() ? { jobTitle: jobTitle.trim() } : {}),
          ...(links.length > 0 ? { links } : {}),
          showOnOrganizationProfile: true,
        },
        identityMutationResponseSchema,
      );
      toast("Identity invitation sent", "success");
      await onAdded();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="pk-stack pk-stack--snug" onSubmit={submit}>
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
            <Field label="Name" required>
              {(control) => (
                <TextInput
                  {...control}
                  value={name}
                  onInput={(event) => setName((event.target as HTMLInputElement).value)}
                />
              )}
            </Field>
            <Field label="Email" required>
              {(control) => (
                <TextInput
                  {...control}
                  type="email"
                  value={email}
                  onInput={(event) => setEmail((event.target as HTMLInputElement).value)}
                />
              )}
            </Field>
            <Field label="Job title">
              {(control) => (
                <TextInput
                  {...control}
                  value={jobTitle}
                  onInput={(event) => setJobTitle((event.target as HTMLInputElement).value)}
                />
              )}
            </Field>
          </div>
          <fieldset class="pk-fieldset pk-field">
            <legend class="pk-field__label">Profile links</legend>
            <ProfileLinksInput fieldName="identity.links" value={links} onChange={setLinks} />
          </fieldset>
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

  return (
    // The name is on the section itself rather than on an id-linked span: a
    // `<section>` is only a named region when it carries one, and `PanelHeader`
    // owns the heading element.
    <Panel class="pk" aria-label="Identities">
      <PanelHeader title="Identities">
        {canManageIdentities && (
          <>
            <Button
              size="sm"
              aria-expanded={addMode === "link"}
              onClick={() => setAddMode((current) => (current === "link" ? "closed" : "link"))}
            >
              {addMode === "link" ? "Cancel" : "Link existing user"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              aria-expanded={addMode === "email"}
              onClick={() => setAddMode((current) => (current === "email" ? "closed" : "email"))}
            >
              {addMode === "email" ? "Cancel" : "Add new person"}
            </Button>
          </>
        )}
      </PanelHeader>
      <PanelBody class="pk-stack">
        {addMode === "link" && canManageIdentities && (
          <LinkExistingUserForm organizationId={organization.id} onAdded={afterAdded} onCancel={closeAdd} />
        )}
        {addMode === "email" && canManageIdentities && (
          <AddIdentityForm organizationId={organization.id} onAdded={afterAdded} onCancel={closeAdd} />
        )}
        <ActingIdentityDirectory
          organizationId={organization.id}
          activeIdentities={organization.identities}
          canManage={canManageIdentities}
          onChanged={onChanged}
          actionsRef={directoryRef}
          /*
           * "No identities" in a table cell says a query returned nothing. It
           * does not say what an identity is, nor what to do about it — and on
           * a new organization that empty table is the whole page.
           *
           * The state names the two controls that fill it rather than
           * repeating them: both already sit in this panel's header, directly
           * above, and a second button under the same accessible name is
           * ambiguous to anyone navigating by name rather than by sight.
           */
          empty={
            <EmptyState
              title="No identities yet"
              body={
                canManageIdentities
                  ? 'An identity is a person who acts for this organization. Use "Link existing user" or "Add new person" above to invite the first one.'
                  : "An identity is a person who acts for this organization. Nobody does yet."
              }
            />
          }
        />
      </PanelBody>
    </Panel>
  );
}
