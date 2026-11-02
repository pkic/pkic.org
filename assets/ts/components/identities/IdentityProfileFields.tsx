/**
 * The fields of one identity's profile: its job title, biography and links.
 * One implementation for every place an identity's profile is edited — the
 * acting identity on the person's own record, any other identity they hold,
 * opened from their professional profile, and staff editing the identity a
 * speaker speaks as — checked by `identityProfileUpdateSchema` or a contract
 * that extends it.
 */
import type { FieldPresentation } from "../../hooks/useContractForm";
import { MarkdownEditor } from "../markdown-editor/MarkdownInput";
import { Alert } from "../../ui/Alert";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";
import { ProfileLinksInput } from "../ProfileLinksInput";

export interface IdentityProfileDraft {
  jobTitle: string;
  biography: string;
  links: string[];
  pendingLink?: string;
}

/** The draft an edit starts from. */
export function identityProfileDraft(identity: {
  jobTitle: string | null;
  biography: string | null;
  links: readonly string[] | null;
}): IdentityProfileDraft {
  return {
    jobTitle: identity.jobTitle ?? "",
    biography: identity.biography ?? "",
    links: [...(identity.links ?? [])],
  };
}

/** The draft as the contract reads it; an empty title or biography clears the stored one. */
export function identityProfileBody(draft: IdentityProfileDraft, organization: boolean) {
  return {
    ...(organization ? { jobTitle: draft.jobTitle.trim() } : {}),
    biography: draft.biography.trim(),
    links: draft.pendingLink?.trim() ? [...draft.links, draft.pendingLink.trim()] : draft.links,
  };
}

/**
 * The notice an identity edit opens with: records made as the identity show
 * the edit too. Its owner is told what to do when the affiliation itself
 * changed; staff are told whose records they are changing.
 */
export function IdentityEditNotice({ editor = "owner" }: { editor?: "owner" | "staff" }) {
  return editor === "owner" ? (
    <p class="pk-muted pk-small">
      Registrations, proposals and other records made as this identity show these changes too. If your affiliation
      itself changed, create a new identity instead of editing this one.
    </p>
  ) : (
    <Alert tone="warn">
      This changes the identity itself. Their registrations, proposals and public profile show the change too.
    </Alert>
  );
}

export function IdentityProfileFields({
  draft,
  onChange,
  of,
  organizationId,
  organizationName,
  purpose = "profile",
}: {
  draft: IdentityProfileDraft;
  onChange: (patch: Partial<IdentityProfileDraft>) => void;
  of: (name: string) => FieldPresentation;
  /** An organization identity carries its own title; an individual one the person's own. */
  organizationId: string | null;
  organizationName?: string | null;
  purpose?: "profile" | "speaker";
}) {
  const organization = organizationName?.trim() || "this organization";
  const biographyLabel = organizationId
    ? `${purpose === "speaker" ? "Your speaker bio" : "Your bio"} at ${organization}`
    : purpose === "speaker"
      ? "Your speaker bio"
      : "About you";
  const biographyHint = organizationId
    ? `Describe your role and relevant experience at ${organization}. This bio is used when you participate or speak as ${organization}. It does not replace About you, your general introduction.`
    : purpose === "speaker"
      ? "This is your general introduction from About you, used when you speak in your own name. To use an organization-specific bio, choose that organization profile instead."
      : "A general introduction covering your interests and roles. For your work at a specific organization, edit that organization’s bio instead.";
  return (
    <>
      {organizationId && (
        <Field label="Job title for this organization" required {...of("jobTitle")}>
          {(control) => (
            <TextInput
              {...control}
              name="jobTitle"
              value={draft.jobTitle}
              onInput={(event) => onChange({ jobTitle: event.currentTarget.value })}
            />
          )}
        </Field>
      )}
      <Field label={biographyLabel} help={biographyHint} {...of("biography")}>
        {(control) => (
          <MarkdownEditor
            profile="basic"
            {...control}
            variant="compact"
            name="biography"
            label={biographyLabel}
            initialValue={draft.biography}
            onChange={(biography) => onChange({ biography })}
          />
        )}
      </Field>
      {/* One URL at a time with its network's mark, never a free-text list to split by line. */}
      <ProfileLinksInput
        fieldName="links"
        label="Social and profile links"
        value={draft.links}
        inputAriaLabel="Profile link URL"
        onChange={(links) => onChange({ links })}
        onPendingChange={(pendingLink) => onChange({ pendingLink })}
        presentation={of("links")}
      />
    </>
  );
}
