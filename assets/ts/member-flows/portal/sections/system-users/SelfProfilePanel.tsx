/**
 * What the person a record is about may change on it.
 *
 * The portal used to answer "my profile" with a page of its own, which drifted
 * from the record everybody else reads about the same person. There is one
 * page now, and this is the part of it that only its subject sees: their name,
 * the identity fields they own, and whether they appear on their
 * organization's public page.
 *
 * It writes through `/api/v1/users/current`, not through the staff update.
 * Nobody administers themselves — a role or a deactivation is somebody else's
 * decision — so editing your own record is the member contract, whatever
 * permissions you also happen to hold.
 */
import { useState } from "preact/hooks";
import { ApiClientError, patchJson } from "../../../../shared/api-client";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { Alert } from "../../../../ui/Alert";
import { Button } from "../../../../ui/Button";
import { Checkbox } from "../../../../ui/Checkbox";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { DescriptionList, type DescriptionListItem } from "../../../../ui/DescriptionList";
import { IconPencil } from "../../../../components/icons";
import { LinkList } from "../../../../ui/LinkList";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";
import { useContractForm } from "../../../../hooks/useContractForm";
import { useEditorDraft } from "../../../../hooks/useEditorDraft";
import { saveProfile } from "../../state";
import { toast } from "../../ui";
import { linksToText, textToLinks } from "../../../../shared/links-text";
import { myProfileSchema, myProfileUpdateSchema } from "../../../../../shared/schemas/me";
import type { MyProfile } from "../../types";

export const CURRENT_USER_API = "/api/v1/users/current";

/**
 * Your own profile fields, on your own record.
 *
 * Whether it is open is the record's decision. It used to render its form the
 * moment the record loaded, so the page arrived already in edit mode —
 * editing is an action somebody takes, not a state a page starts in (#47),
 * and the record's "…" menu is where that action is offered.
 */
export function SelfProfilePanel({
  profile,
  editing,
  onEdit,
  onClose,
  onSaved,
}: {
  profile: MyProfile;
  editing: boolean;
  /** Starts the edit, from this card's own quiet affordance (#46). */
  onEdit: () => void;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  // Opening starts from the profile as it stands (see `useEditorDraft`): the
  // fields are seeded when the record's edit command opens them, and a
  // refresh while they are open does not retype them.
  const [form, setForm] = useEditorDraft(editing, () => ({
    firstName: profile.firstName ?? "",
    lastName: profile.lastName ?? "",
    preferredName: profile.preferredName ?? "",
    emailId: profile.emailId ?? "",
    jobTitle: profile.jobTitle ?? "",
    biography: profile.biography ?? "",
    linksText: linksToText(profile.links ?? []),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibilitySaving, setVisibilitySaving] = useState(false);

  /*
   * One basis for validation: the draft is checked, live and on submit, by the
   * same `myProfileUpdateSchema` the route parses, so a name over 120
   * characters or a malformed link is marked on the field that caused it
   * rather than refused by the server as an unexplained failure.
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
    ...(profile.organizationId ? { emailId: form.emailId || null, jobTitle: form.jobTitle.trim() } : {}),
  };
  const profileForm = useContractForm(myProfileUpdateSchema, contractBody);

  async function handleSubmit(event: Event): Promise<void> {
    event.preventDefault();
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
      saveProfile(await patchJson(CURRENT_USER_API, checked.data, myProfileSchema));
      toast("Profile updated", "success");
      // The record around this panel states the same names and biography, so
      // it is re-read rather than left showing what it loaded before the save.
      await onSaved();
    } catch (cause) {
      // A server refusal names its fields the way the contract does.
      setError(profileForm.refuse(cause));
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
      await onSaved();
    } catch (cause) {
      toast(cause instanceof ApiClientError ? cause.message : "Could not update visibility.", "error");
    } finally {
      setVisibilitySaving(false);
    }
  }

  /*
   * What this card states when nobody is editing: exactly the fields it
   * writes, in the order it writes them. An unset one keeps its row and shows
   * an em dash — a member looking for where to put their job title needs to
   * see that the field exists and is empty.
   */
  const selfFacts: DescriptionListItem[] = [
    { term: "First name", value: profile.firstName },
    { term: "Last name", value: profile.lastName },
    { term: "Preferred name", value: profile.preferredName },
    ...(profile.organizationId ? [{ term: "Job title", value: profile.jobTitle }] : []),
    { term: "Biography", value: profile.biography },
    {
      term: "Links",
      value: (profile.links ?? []).length > 0 ? <LinkList links={profile.links ?? []} /> : null,
    },
  ];

  return (
    <Panel aria-label="Your profile">
      <PanelHeader title="Your profile">
        {/* The same quiet way in the Account card offers, on the card whose
            fields these are. The record's actions menu still names the
            command in words. */}
        {!editing && (
          <Button size="sm" variant="ghost" icon aria-label="Edit profile" title="Edit profile" onClick={onEdit}>
            <IconPencil />
          </Button>
        )}
      </PanelHeader>
      <PanelBody class="pk-stack">
        {/*
          Closed, the card states what it edits.

          It used to render a titled panel whose entire body was empty until
          somebody started editing — a box with a heading and nothing in it,
          which is the same "fundamentally wrong" shape #46 objected to on the
          staff side. These are the fields a member holds themselves, so they
          are read here and written here, in one place (#46).
        */}
        {!editing && <DescriptionList density="compact" items={selfFacts} />}
        {/* The fields open only when the record asks for them (#47).
            `noValidate`, so the browser's own bubble never speaks ahead of
            the contract. */}
        {editing && (
          <form
            noValidate
            class="pk-stack"
            {...profileForm.handlers}
            onSubmit={(event) => {
              void handleSubmit(event);
            }}
          >
            <div class="pk-grid pk-grid--tight">
              <Field label="First name" required {...profileForm.of("firstName")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="firstName"
                    value={form.firstName}
                    onInput={(event) => setForm((f) => ({ ...f, firstName: event.currentTarget.value }))}
                  />
                )}
              </Field>
              <Field label="Last name" required {...profileForm.of("lastName")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="lastName"
                    value={form.lastName}
                    onInput={(event) => setForm((f) => ({ ...f, lastName: event.currentTarget.value }))}
                  />
                )}
              </Field>
              <Field label="Preferred name" {...profileForm.of("preferredName")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="preferredName"
                    value={form.preferredName}
                    onInput={(event) => setForm((f) => ({ ...f, preferredName: event.currentTarget.value }))}
                    placeholder="Shown instead of first/last name if set"
                  />
                )}
              </Field>
              {profile.organizationId && (
                <Field
                  label="Email for this organization"
                  help="Used for your profile and actions in this organization capacity."
                  {...profileForm.of("emailId")}
                >
                  {(control) => (
                    <Select
                      {...control}
                      name="emailId"
                      value={form.emailId}
                      onChange={(event) => setForm((f) => ({ ...f, emailId: event.currentTarget.value }))}
                    >
                      {profile.emailAddresses.map((address) => (
                        <option value={address.id ?? ""} key={address.id ?? "primary"}>
                          {address.email}
                          {address.primary ? " (primary)" : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {profile.organizationId && (
                <Field label="Job title for this organization" {...profileForm.of("jobTitle")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="jobTitle"
                      value={form.jobTitle}
                      onInput={(event) => setForm((f) => ({ ...f, jobTitle: event.currentTarget.value }))}
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
                  name="biography"
                  value={form.biography}
                  onInput={(event) => setForm((f) => ({ ...f, biography: event.currentTarget.value }))}
                />
              )}
            </Field>

            <Field label="Social / profile links" {...profileForm.of("links")}>
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  placeholder="One URL per line"
                  name="links"
                  value={form.linksText}
                  onInput={(event) => setForm((f) => ({ ...f, linksText: event.currentTarget.value }))}
                />
              )}
            </Field>

            {error && <Alert tone="danger">{friendlyErrorMessage(error)}</Alert>}

            <div class="pk-cluster">
              <Button type="submit" variant="primary" loading={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button size="sm" disabled={saving} onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {/* The one visibility rule a member holds themselves. It stays with
            the fields it governs — the name, job title and bio just above —
            rather than in the record's read-only Visibility summary. */}
        {profile.organizationId && (
          <Checkbox
            role="switch"
            checked={profile.showOnOrgProfile}
            disabled={visibilitySaving}
            onChange={(event) => void handleVisibilityToggle(event.currentTarget.checked)}
            label={
              <>Show my name, job title, and bio on {profile.organizationName ?? "my organization"}'s public page</>
            }
          />
        )}
      </PanelBody>
    </Panel>
  );
}
