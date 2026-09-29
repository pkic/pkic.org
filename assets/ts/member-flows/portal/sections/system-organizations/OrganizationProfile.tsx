import { useMembershipCategoryCatalog } from "../../../../hooks/useMembershipCategoryCatalog";
import { useMembershipCategoryLabels } from "../../../../hooks/useMembershipCategoryLabels";
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
import { type OrganizationDetail } from "../../../../../shared/schemas/organization-management";
import { MarkdownEditor } from "../../../../components/markdown-editor/MarkdownInput";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { ORGANIZATION_CONTENT_MARKDOWN_HELP } from "../../../../shared/organization-content";
import type { FieldPresentation } from "../../../../hooks/useContractForm";
import { DescriptionList, type DescriptionListItem } from "../../../../ui/DescriptionList";
import { Field } from "../../../../ui/Field";
import { LinkList } from "../../../../ui/LinkList";
import { Menu } from "../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Select, TextInput } from "../../../../ui/TextControl";
import { fmt, fmtDate } from "../../ui";
import type { OrganizationDraft, OrganizationTextField } from "./OrganizationDraft";
import "../../../../ui/Content.css";
import { Markdown } from "../../../../components/Markdown";

/** What a card needs to read the record and, while the page edits, the draft. */
export interface OrganizationCardProps {
  organization: OrganizationDetail;
  /** The page's draft while it is editing; absent when reading. */
  draft?: OrganizationDraft;
  onDraft?: (next: Partial<OrganizationDraft>) => void;
  busy?: boolean;
  /** Each field's live validation state, by field name. */
  fields?: (name: string) => FieldPresentation;
  onEdit?: () => void;
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
        <PanelHeader title="About" />
        <PanelBody class="pk-stack">
          <TextField field="name" label="Name" required maxLength={200} {...edit} />
          <TextField field="slogan" label="Slogan" maxLength={300} {...edit} />
          <Field label="Description" {...fields("description")}>
            {(control) => (
              <MarkdownEditor
                variant="compact"
                {...control}
                name="description"
                label="Description"
                initialValue={draft.description}
                disabled={busy}
                onChange={(description) => onDraft({ description })}
              />
            )}
          </Field>
          <Field label="Member page content" help={ORGANIZATION_CONTENT_MARKDOWN_HELP} {...fields("contentMarkdown")}>
            {(control) => (
              <MarkdownEditor
                {...control}
                name="contentMarkdown"
                label="Member page content"
                initialValue={draft.contentMarkdown}
                disabled={busy}
                onChange={(contentMarkdown) => onDraft({ contentMarkdown })}
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
      <PanelHeader title="About">
        {props.onEdit && (
          <Menu
            label="About actions"
            align="end"
            items={[{ id: "edit", label: "Edit organization…", onSelect: props.onEdit }]}
          />
        )}
      </PanelHeader>
      <PanelBody class="pk-stack pk-stack--snug">
        {organization.description ? (
          <Markdown className="pk-prose-block pk-prose-block--full" markdown={organization.description} />
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
        {/* Named by the widget, like every other field on this form, rather
            than by a fieldset wrapped round it for the label alone. */}
        <ProfileLinksInput
          fieldName="organization.links"
          label="Other links"
          value={edit.draft.links}
          inputAriaLabel="Organization profile URL"
          onChange={(links) => edit.onDraft({ links })}
        />
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
  const categories = useMembershipCategoryLabels();
  const catalog = useMembershipCategoryCatalog();
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
                  {catalog
                    .filter((entry) => !entry.isIndividual)
                    .map(({ code: category }) => (
                      <option key={category} value={category}>
                        {categories.label(category)}
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
                  { term: "Category", value: categories.label(organization.membershipCategory) || "Not a member" },
                  // A calendar date, not an instant: the contract is `z.iso.date()`.
                  { term: "Member since", value: fmtDate(organization.memberSince) },
                  {
                    // The address the public actually sees. Staff could not
                    // tell whether a record had a readable one or was still
                    // answering on its id (#15), and the page is one click
                    // away rather than a URL to assemble by hand.
                    term: "Member page",
                    value: (
                      <a class="pk-break" href={organization.publicProfileHref} target="_blank" rel="noopener">
                        {organization.publicProfileHref}
                      </a>
                    ),
                  },
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
