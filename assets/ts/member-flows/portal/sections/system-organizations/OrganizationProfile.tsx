/**
 * The organization account page's cards, each readable and — in the page's
 * edit mode — editable in place.
 *
 * There is no separate editor form. When the page is editing, every card
 * keeps its place and its content becomes fields: the slogan and description
 * in the About card, the links under the mark, the membership facts in the
 * Membership card. The fields are the design system's `Field` with its typed
 * controls, checked live the way the join form is, so a URL is a URL field
 * and a bad one says so as it is typed. The page owns one draft and one
 * Save; a card only reads and updates the draft.
 */
import {
  orgTiedMembershipCategorySchema,
  type OrganizationDetail,
} from "../../../../../shared/schemas/organization-management";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import type { FieldPresentation } from "../../../../hooks/useContractForm";
import { DescriptionList, type DescriptionListItem } from "../../../../ui/DescriptionList";
import { Field } from "../../../../ui/Field";
import { LinkList } from "../../../../ui/LinkList";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, Textarea, TextInput } from "../../../../ui/TextControl";
import { fmt, fmtDate } from "../../ui";
import type { OrganizationDraft, OrganizationTextField } from "./OrganizationDraft";
import "../../../../ui/Content.css";

const ORG_TIED_MEMBERSHIP_CATEGORIES = orgTiedMembershipCategorySchema.options;

/** What a card needs to read the record and, while the page edits, the draft. */
export interface OrganizationCardProps {
  organization: OrganizationDetail;
  /** The page's draft while it is editing; absent when reading. */
  draft?: OrganizationDraft;
  onDraft?: (next: Partial<OrganizationDraft>) => void;
  busy?: boolean;
  /** Each field's live validation state, by field name. */
  fields?: (name: string) => FieldPresentation;
}

interface EditorProps {
  draft: OrganizationDraft;
  onDraft: (next: Partial<OrganizationDraft>) => void;
  busy?: boolean;
  fields: (name: string) => FieldPresentation;
}

function editor(props: OrganizationCardProps): EditorProps | null {
  if (!props.draft || !props.onDraft) return null;
  return { draft: props.draft, onDraft: props.onDraft, busy: props.busy, fields: props.fields ?? (() => ({})) };
}

/** One text field of the draft, checked live; a URL field is typed as one. */
function TextField({
  field,
  label,
  type = "text",
  required,
  maxLength,
  draft,
  onDraft,
  busy,
  fields,
}: EditorProps & {
  field: OrganizationTextField;
  label: string;
  type?: "text" | "url";
  required?: boolean;
  maxLength: number;
}) {
  const url = type === "url";
  return (
    <Field label={label} required={required} {...fields(field)}>
      {(control) => (
        <TextInput
          {...control}
          name={field}
          type={type}
          maxLength={maxLength}
          inputMode={url ? "url" : undefined}
          autocomplete={url ? "url" : undefined}
          spellcheck={url ? false : undefined}
          placeholder={url ? "https://" : undefined}
          value={draft[field]}
          disabled={busy}
          onInput={(event) => onDraft({ [field]: (event.target as HTMLInputElement).value })}
        />
      )}
    </Field>
  );
}

/**
 * What the organization says about itself: the slogan as the lead line, the
 * description as prose. Editing puts the fields in the same card.
 */
export function OrganizationAbout(props: OrganizationCardProps) {
  const { organization } = props;
  const edit = editor(props);
  if (edit) {
    const { draft, onDraft, busy, fields } = edit;
    return (
      <Panel aria-label="About">
        <PanelBody class="pk-stack">
          <TextField field="name" label="Name" required maxLength={200} {...edit} />
          <TextField field="slogan" label="Slogan" maxLength={300} {...edit} />
          <Field label="Description" {...fields("description")}>
            {(control) => (
              <Textarea
                {...control}
                name="description"
                rows={3}
                maxLength={2000}
                value={draft.description}
                disabled={busy}
                onInput={(event) => onDraft({ description: (event.target as HTMLTextAreaElement).value })}
              />
            )}
          </Field>
          <Field
            label="Member page content"
            help="Markdown, shown on the organization's public member page."
            {...fields("contentMarkdown")}
          >
            {(control) => (
              <Textarea
                {...control}
                name="contentMarkdown"
                class="pk-mono"
                rows={6}
                maxLength={20000}
                value={draft.contentMarkdown}
                disabled={busy}
                onInput={(event) => onDraft({ contentMarkdown: (event.target as HTMLTextAreaElement).value })}
              />
            )}
          </Field>
        </PanelBody>
      </Panel>
    );
  }
  // The slogan is the record's lede, under the name in the header — stating it
  // again here printed the same line twice on one screen.
  return (
    <Panel aria-label="About">
      <PanelHeader title="About" />
      <PanelBody class="pk-stack pk-stack--snug">
        {organization.description ? (
          <p class="pk-prose-block">{organization.description}</p>
        ) : (
          <p class="pk-muted">Nothing written about this organization yet.</p>
        )}
      </PanelBody>
    </Panel>
  );
}

const LINK_FIELDS = [
  ["Website", "website"],
  ["Blog", "blogUrl"],
  ["Blog feed", "blogFeedUrl"],
  ["Press", "pressUrl"],
  ["Press feed", "pressFeedUrl"],
  ["Careers", "careersUrl"],
] as const;

/**
 * Where to find the organization: a row of links under its mark. Editing
 * turns the row into URL fields in the same card, plus the profile links the
 * flexible link schema carries.
 */
export function OrganizationLinks(props: OrganizationCardProps) {
  const { organization } = props;
  const edit = editor(props);
  if (edit) {
    return (
      <div class="pk-stack">
        {LINK_FIELDS.map(([label, field]) => (
          <TextField key={field} field={field} label={label} type="url" maxLength={2048} {...edit} />
        ))}
        <fieldset class="pk-fieldset pk-field">
          <legend class="pk-field__label">Profiles</legend>
          <ProfileLinksInput
            fieldName="organization.links"
            value={edit.draft.links}
            inputAriaLabel="Organization profile URL"
            onChange={(links) => edit.onDraft({ links })}
          />
        </fieldset>
      </div>
    );
  }
  // Feeds are for machines; the list shows the pages a person would open.
  const pages: DescriptionListItem[] = [];
  for (const [label, field] of LINK_FIELDS) {
    if (field.endsWith("FeedUrl")) continue;
    const url = organization[field];
    if (!url) continue;
    pages.push({
      term: label,
      value: (
        <a class="pk-break" href={url} target="_blank" rel="noopener noreferrer">
          {url.replace(/^https?:\/\//, "")}
        </a>
      ),
    });
  }
  // The flexible profile links were editable and never shown: they are stored
  // as bare URLs, so they get the same marked list a contact record uses
  // rather than a label this record cannot know.
  if (pages.length === 0 && organization.links.length === 0) return null;
  return (
    <div class="pk-stack pk-stack--snug">
      {pages.length > 0 && <DescriptionList density="compact" items={pages} />}
      <LinkList links={organization.links} />
    </div>
  );
}

/** The organization's standing as a member; category and date edit in the same card. */
export function OrganizationMembershipCard(props: OrganizationCardProps) {
  const { organization } = props;
  const edit = editor(props);
  const created: DescriptionListItem = { term: "Created", value: fmt(organization.createdAt) };
  return (
    <Panel aria-label="Membership">
      <PanelHeader title="Membership" />
      <PanelBody class="pk-stack">
        {edit && (
          <>
            <Field label="Category" {...edit.fields("membershipCategory")}>
              {(control) => (
                <Select
                  {...control}
                  name="membershipCategory"
                  value={edit.draft.membershipCategory}
                  disabled={edit.busy}
                  onChange={(event) => edit.onDraft({ membershipCategory: (event.target as HTMLSelectElement).value })}
                >
                  {ORG_TIED_MEMBERSHIP_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Member since" {...edit.fields("memberSince")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="memberSince"
                  type="date"
                  value={edit.draft.memberSince}
                  disabled={edit.busy}
                  onInput={(event) => edit.onDraft({ memberSince: (event.target as HTMLInputElement).value })}
                />
              )}
            </Field>
          </>
        )}
        <DescriptionList
          density="compact"
          items={
            edit
              ? [created]
              : [
                  { term: "Category", value: organization.membershipCategory },
                  // A calendar date, not an instant: the contract is `z.iso.date()`.
                  { term: "Member since", value: fmtDate(organization.memberSince) },
                  created,
                ]
          }
        />
      </PanelBody>
    </Panel>
  );
}

const CONTACT_FIELDS = [
  ["Primary contact", "primaryContactUserId"],
  ["Secondary contact", "secondaryContactUserId"],
] as const;

/** Who to talk to: names when reading, a pick from the representatives when editing. */
export function OrganizationContacts(props: OrganizationCardProps) {
  const { organization } = props;
  const edit = editor(props);
  function contactName(userId: string | null): string | null {
    if (!userId) return null;
    const representative = organization.identities.find((candidate) => candidate.userId === userId);
    return representative ? representative.name : null;
  }
  return (
    <Panel aria-label="Contacts">
      <PanelHeader title="Contacts" />
      <PanelBody class="pk-stack">
        {edit ? (
          CONTACT_FIELDS.map(([label, field]) => {
            const other = field === "primaryContactUserId" ? "secondaryContactUserId" : "primaryContactUserId";
            return (
              <Field key={field} label={label} {...edit.fields(field)}>
                {(control) => (
                  <Select
                    {...control}
                    name={field}
                    value={edit.draft[field]}
                    disabled={edit.busy}
                    onChange={(event) => edit.onDraft({ [field]: (event.target as HTMLSelectElement).value })}
                  >
                    <option value="">None</option>
                    {organization.identities
                      // One person cannot hold both contact roles; the service
                      // enforces it, the select simply hides the collision.
                      .filter((representative) => representative.userId !== edit.draft[other])
                      .map((representative) => (
                        <option key={representative.userId} value={representative.userId}>
                          {representative.name} ({representative.email})
                        </option>
                      ))}
                  </Select>
                )}
              </Field>
            );
          })
        ) : (
          <DescriptionList
            density="compact"
            items={CONTACT_FIELDS.map(([label, field]) => ({ term: label, value: contactName(organization[field]) }))}
          />
        )}
      </PanelBody>
    </Panel>
  );
}
