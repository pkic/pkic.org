/**
 * My Profile — edit. Editable fields: first
 * name, last name, preferred name, and identity-owned profile fields.
 * Headshot upload and the organization-page
 * visibility toggle live in the same tab nav table.
 */
import { useRef, useState } from "preact/hooks";
import { deleteJson, getJson, patchJson, postJson, putJson, ApiClientError } from "../../../shared/api-client";
import { AdminHeadshotManager } from "../../../shared/headshot/AdminHeadshotManager";
import { replaceFile } from "../../../shared/file-upload";
import { friendlyErrorMessage } from "../../../components/ErrorAlert";
import { Alert } from "../../../ui/Alert";
import { Avatar } from "../../../ui/Avatar";
import { Badge } from "../../../ui/Badge";
import { Button } from "../../../ui/Button";
import { Checkbox } from "../../../ui/Checkbox";
import { Field } from "../../../ui/Field";
import { ProfileHeader } from "../../../ui/ProfileHeader";
import { Panel, PanelBody, PanelHeader } from "../../../ui/Panel";
import { Spinner } from "../../../ui/Spinner";
import { Select, Textarea, TextInput } from "../../../ui/TextControl";
import { useContractForm } from "../../../hooks/useContractForm";
import { profile as profileSignal, saveProfile } from "../state";
import { toast } from "../ui";
import { formatCalendarDate } from "../../../shared/ui";
import type { MyProfile as MyProfileType } from "../types";
import { linksToText, textToLinks } from "../../../shared/links-text";
import {
  myHeadshotDeleteResponseSchema,
  myHeadshotUploadResponseSchema,
  myProfileSchema,
  myProfileUpdateSchema,
} from "../../../../shared/schemas/me";
import { identityCreateSchema, identityMutationResponseSchema } from "../../../../shared/schemas/identity";
import type { ApiTableActions } from "../../../components/ApiDataTable";
import { ActingIdentityDirectory } from "./OrganizationIdentityDirectory";
import { useMembershipCategoryLabels } from "../../../hooks/useMembershipCategoryLabels";
import "../../../ui/Content.css";

const CURRENT_USER_API = "/api/v1/users/current";

async function refreshProfile(): Promise<void> {
  const refreshed = await getJson(CURRENT_USER_API, myProfileSchema);
  saveProfile(refreshed);
}

/** The name the member is known by, falling back through what they have filled in. */
function displayName(current: MyProfileType): string {
  const full = [current.firstName, current.lastName].filter(Boolean).join(" ").trim();
  return current.preferredName?.trim() || full || current.email;
}

export function MyProfile() {
  const current = profileSignal.value;
  const [form, setForm] = useState(() => ({
    firstName: current?.firstName ?? "",
    lastName: current?.lastName ?? "",
    preferredName: current?.preferredName ?? "",
    emailId: current?.emailId ?? "",
    jobTitle: current?.jobTitle ?? "",
    biography: current?.biography ?? "",
    linksText: linksToText(current?.links ?? []),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * One basis for validation: the draft is checked, live and on submit, by the
   * same `myProfileUpdateSchema` the route parses. It used to be hand-built at
   * submit time and sent unchecked, so a name over 120 characters or a
   * malformed link was refused by the server as an unexplained failure rather
   * than marked on the field that caused it.
   *
   * A job title and an organization email belong to an organization-tied
   * identity; an individual member has neither, and the route rejects them.
   */
  const contractBody = {
    firstName: form.firstName.trim() || undefined,
    lastName: form.lastName.trim() || undefined,
    preferredName: form.preferredName.trim(),
    biography: form.biography.trim(),
    links: textToLinks(form.linksText),
    ...(current?.organizationId ? { emailId: form.emailId || null, jobTitle: form.jobTitle.trim() } : {}),
  };
  const profileForm = useContractForm(myProfileUpdateSchema, contractBody);
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const categories = useMembershipCategoryLabels();

  if (!current) return <Spinner label="Loading your profile…" />;

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);
    // Nothing leaves the page until the contract accepts the whole draft; a
    // refusal it can attribute to a field is shown on that field.
    const checked = profileForm.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSaving(true);
    try {
      const updated = await patchJson(CURRENT_USER_API, checked.data, myProfileSchema);
      saveProfile(updated);
      toast("Profile updated", "success");
    } catch (err) {
      // A server refusal names its fields the way the contract does.
      setError(profileForm.refuse(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleVisibilityToggle(next: boolean): Promise<void> {
    setVisibilitySaving(true);
    try {
      saveProfile(await patchJson(CURRENT_USER_API, { showOnOrgProfile: next }, myProfileSchema));
      toast(
        next
          ? "You'll now appear on your organization's public page"
          : "You're now hidden from your organization's public page",
        "success",
      );
    } catch (err) {
      toast(err instanceof ApiClientError ? err.message : "Could not update visibility.", "error");
    } finally {
      setVisibilitySaving(false);
    }
  }

  return (
    <div class="pk pk-stack">
      {/*
        The member's own record opens with the member, the way the staff view
        of the same person does — `ProfileHeader` names a subject, `PageHeader`
        named a place, and "My Profile" told a reader nothing the sidebar had
        not already said. The identifying facts move here from the Membership
        card, so the page states them once.
      */}
      <ProfileHeader
        media={<Avatar name={displayName(current)} src={current.headshotUrl ?? undefined} size="xl" />}
        title={displayName(current)}
        lede={[current.jobTitle, current.organizationName].filter(Boolean).join(" at ") || undefined}
        facts={[
          current.email,
          categories.label(current.membershipCategory),
          current.memberSince ? `Member since ${formatCalendarDate(current.memberSince)}` : null,
        ].filter((fact): fact is string => Boolean(fact))}
      />
      {/* The form is the page's work and leads; the headshot, visibility
          toggle, membership summary and identity switcher keep it company as
          an aside. The identities roster spans the full width below the grid —
          a data table in a half-width column clipped its own status and role
          columns and left the other column mostly empty. */}
      <div class="pk-grid pk-grid--roomy">
        <div class="pk-stack">
          <Panel>
            <PanelBody>
              {/* `noValidate`, so the browser's own bubble never speaks ahead
                  of the contract. */}
              <form
                noValidate
                class="pk-stack"
                {...profileForm.handlers}
                onSubmit={(e) => {
                  void handleSubmit(e);
                }}
              >
                <div class="pk-grid pk-grid--tight">
                  <Field label="First name" required {...profileForm.of("firstName")}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={form.firstName}
                        onInput={(e) => setForm((f) => ({ ...f, firstName: (e.target as HTMLInputElement).value }))}
                      />
                    )}
                  </Field>
                  {current.organizationId && (
                    <Field
                      label="Email for this organization"
                      help="Used for your profile and actions in this organization capacity."
                      {...profileForm.of("emailId")}
                    >
                      {(control) => (
                        <Select
                          {...control}
                          value={form.emailId}
                          onChange={(e) => setForm((f) => ({ ...f, emailId: (e.target as HTMLSelectElement).value }))}
                        >
                          {current.emailAddresses.map((address) => (
                            <option value={address.id ?? ""} key={address.id ?? "primary"}>
                              {address.email}
                              {address.primary ? " (primary)" : ""}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                  )}
                  <Field label="Last name" required {...profileForm.of("lastName")}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={form.lastName}
                        onInput={(e) => setForm((f) => ({ ...f, lastName: (e.target as HTMLInputElement).value }))}
                      />
                    )}
                  </Field>
                  <Field label="Preferred name" {...profileForm.of("preferredName")}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={form.preferredName}
                        onInput={(e) => setForm((f) => ({ ...f, preferredName: (e.target as HTMLInputElement).value }))}
                        placeholder="Shown instead of first/last name if set"
                      />
                    )}
                  </Field>
                  {current.organizationId && (
                    <Field label="Job title for this organization" {...profileForm.of("jobTitle")}>
                      {(control) => (
                        <TextInput
                          {...control}
                          value={form.jobTitle}
                          onInput={(e) => setForm((f) => ({ ...f, jobTitle: (e.target as HTMLInputElement).value }))}
                        />
                      )}
                    </Field>
                  )}
                </div>

                <Field label="Biography" {...profileForm.of("biography")}>
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={5}
                      value={form.biography}
                      onInput={(e) => setForm((f) => ({ ...f, biography: (e.target as HTMLTextAreaElement).value }))}
                    />
                  )}
                </Field>

                <Field label="Social / profile links" {...profileForm.of("links")}>
                  {(control) => (
                    <Textarea
                      {...control}
                      rows={3}
                      placeholder="One URL per line"
                      value={form.linksText}
                      onInput={(e) => setForm((f) => ({ ...f, linksText: (e.target as HTMLTextAreaElement).value }))}
                    />
                  )}
                </Field>

                {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}

                <div class="pk-cluster">
                  <Button type="submit" variant="primary" loading={saving}>
                    {saving ? "Saving…" : "Save changes"}
                  </Button>
                </div>
              </form>
            </PanelBody>
          </Panel>
        </div>

        <div class="pk-stack">
          <Panel>
            <PanelBody>
              <AdminHeadshotManager
                initialUrl={current.headshotUrl}
                alt={current.email}
                emptyLabel="You"
                helpText="JPEG, PNG, or WebP, up to 5MB."
                uploadHeadshot={async (file) => {
                  await replaceFile(`${CURRENT_USER_API}/headshot`, file, myHeadshotUploadResponseSchema);
                  await refreshProfile();
                  return { headshotUrl: profileSignal.value?.headshotUrl };
                }}
                deleteHeadshot={async () => {
                  try {
                    await deleteJson(`${CURRENT_USER_API}/headshot`, myHeadshotDeleteResponseSchema);
                  } catch (err) {
                    // The shared controller writes whatever this throws into
                    // its own live region, so a bare "HTTP 500" is translated
                    // here rather than only where the toast is raised.
                    throw new Error(
                      err instanceof ApiClientError
                        ? friendlyErrorMessage(err.message)
                        : "Could not remove your headshot. Please try again.",
                      { cause: err },
                    );
                  }
                  await refreshProfile();
                }}
                confirmDeleteMessage="Remove your headshot?"
                onDeleted={() => toast("Headshot removed", "success")}
                onError={(message) => toast(message, "error")}
              />
            </PanelBody>
          </Panel>

          {current.organizationId && (
            <Panel>
              <PanelBody>
                <Checkbox
                  role="switch"
                  checked={current.showOnOrgProfile}
                  disabled={visibilitySaving}
                  onChange={(e) => void handleVisibilityToggle((e.target as HTMLInputElement).checked)}
                  label={
                    <>
                      Show my name, job title, and bio on {current.organizationName ?? "my organization"}'s public page
                    </>
                  }
                />
              </PanelBody>
            </Panel>
          )}

          {current.activeIdentities.length > 1 && <ActiveIdentitySwitcher current={current} />}
        </div>
      </div>

      {current.organizationIdentities && <OrganizationIdentitiesCard current={current} />}
    </div>
  );
}

function OrganizationIdentitiesCard({ current }: { current: MyProfileType }) {
  const directoryRef = useRef<ApiTableActions | null>(null);
  const [showAddCoworker, setShowAddCoworker] = useState(false);

  if (!current.organizationId || !current.organizationIdentities) return null;
  const primaryContactUserId = current.organizationIdentities.find((identity) => identity.isPrimaryContact)?.userId;

  return (
    <Panel>
      <PanelHeader title="Organization identities" />
      <PanelBody class="pk-stack pk-stack--snug">
        {current.isOrgContact && showAddCoworker && (
          <AddCoworkerForm
            organizationId={current.organizationId}
            onCancel={() => setShowAddCoworker(false)}
            onAdded={async () => {
              setShowAddCoworker(false);
              await refreshProfile();
              await directoryRef.current?.reload();
            }}
          />
        )}
        <ActingIdentityDirectory
          organizationId={current.organizationId}
          activeIdentities={current.organizationIdentities}
          canManage={current.isOrgContact}
          canBlock={(userId) => userId !== current.userId && userId !== primaryContactUserId}
          onChanged={refreshProfile}
          actionsRef={directoryRef}
          createAction={
            current.isOrgContact ? { label: "Add coworker", onSelect: () => setShowAddCoworker(true) } : undefined
          }
        />
      </PanelBody>
    </Panel>
  );
}

/**
 * Only rendered when the caller represents more than one organization (or
 * an organization plus their own individual membership) concurrently —
 * lets them pick which membership context the rest of the portal (working
 * groups, votes, applications, etc.) acts as. Switching reissues the
 * session cookie server-side (PUT /api/v1/users/current/identities/active) and then
 * does a full navigation rather than a signal update, so every other
 * org-scoped screen re-fetches under the new context instead of holding
 * stale state from the previous one.
 */
function ActiveIdentitySwitcher({ current }: { current: MyProfileType }) {
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The currently-active entry is whichever membership matches the
  // organization (or org-less-ness) the rest of this profile response is
  // already scoped to.
  const activeIdentityId = current.activeIdentities.find(
    (identity) => identity.organizationId === current.organizationId,
  )?.identityId;

  async function handleSwitch(identityId: string): Promise<void> {
    if (identityId === activeIdentityId) return;
    setError(null);
    setSwitching(identityId);
    try {
      await putJson(`${CURRENT_USER_API}/identities/active`, { identityId }, myProfileSchema);
      // A full reload, not window.location.assign to this same route — the
      // caller is already on #/profile, so assigning that same URL is a
      // no-op and would leave every other org-scoped screen (working
      // groups, votes, applications) holding state from the org context
      // just switched away from.
      window.location.reload();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not switch membership. Please try again.");
      setSwitching(null);
    }
  }

  return (
    <Panel>
      <PanelHeader title="Acting as" />
      <PanelBody class="pk-stack pk-stack--snug">
        <p class="pk-muted pk-small">
          You hold more than one active identity. Switch which exact identity the portal acts as below.
        </p>
        <ul class="pk-stack pk-stack--tight">
          {current.activeIdentities.map((identity) => {
            const isActive = identity.identityId === activeIdentityId;
            return (
              <li key={identity.identityId} class="pk-cluster pk-cluster--between">
                <span>
                  {identity.organizationName ?? "My individual identity"}{" "}
                  <span class="pk-muted pk-small">(Category {identity.membershipCategory})</span>
                </span>
                {isActive ? (
                  <Badge tone="ok">Current</Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={switching !== null}
                    onClick={() => void handleSwitch(identity.identityId)}
                  >
                    {switching === identity.identityId ? "Switching…" : "Switch"}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}
      </PanelBody>
    </Panel>
  );
}

function AddCoworkerForm({
  organizationId,
  onAdded,
  onCancel,
}: {
  organizationId: string;
  onAdded: () => Promise<void>;
  onCancel: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  /*
   * The same contract the route parses. The draft used to be read back out of
   * the DOM with `form.elements.namedItem` and checked with `if (!name ||
   * !email) return` — a hand-written rule that silently did nothing, so a
   * reader who left a field blank got no field marked and no message.
   */
  const [draft, setDraft] = useState({ name: "", email: "" });
  const form = useContractForm(identityCreateSchema, {
    userReference: "email",
    name: draft.name.trim(),
    email: draft.email.trim(),
    activation: { mode: "invitation" },
    showOnOrganizationProfile: true,
  });

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setSubmitting(true);
    try {
      await postJson(
        `/api/v1/organizations/${encodeURIComponent(organizationId)}/identities`,
        checked.data,
        identityMutationResponseSchema,
      );
      setSuccess(
        `${draft.name.trim()} (${draft.email.trim()}) was invited to accept an identity for your organization.`,
      );
      setDraft({ name: "", email: "" });
      await onAdded();
    } catch (err) {
      setError(form.refuse(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="pk-stack pk-stack--snug">
      <div class="pk-cluster pk-cluster--between">
        <h4>Add a coworker</h4>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <form
        noValidate
        class="pk-stack pk-stack--snug"
        {...form.handlers}
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        <div class="pk-grid pk-grid--tight">
          <Field label="Name" required {...form.of("name")}>
            {(control) => (
              <TextInput
                {...control}
                type="text"
                name="name"
                value={draft.name}
                onInput={(event) => setDraft((current) => ({ ...current, name: event.currentTarget.value }))}
              />
            )}
          </Field>
          <Field label="Email" required {...form.of("email")}>
            {(control) => (
              <TextInput
                {...control}
                type="email"
                name="email"
                value={draft.email}
                onInput={(event) => setDraft((current) => ({ ...current, email: event.currentTarget.value }))}
              />
            )}
          </Field>
        </div>
        <div class="pk-cluster">
          <Button type="submit" variant="primary" size="sm" loading={submitting}>
            {submitting ? "Adding…" : "Add coworker"}
          </Button>
        </div>
      </form>
      {success && <Alert tone="ok">{success}</Alert>}
      {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}
    </div>
  );
}
