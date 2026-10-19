import { useState } from "preact/hooks";
import {
  MAX_SESSION_AFFILIATIONS,
  sessionAppearanceChoicesSchema,
  sessionAppearanceSchema,
  type SessionAffiliation,
  type SessionAppearance,
  type SessionProposalRepresentation,
} from "../../../../../../../shared/schemas/event-session-history";
import type { AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { candidateAffiliations } from "../../../../../../../shared/session-public-credits";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { FormSection } from "../../../../../../ui/FormSection";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Textarea, Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Avatar } from "../../../../../../ui/Avatar";
import { LinkList } from "../../../../../../ui/LinkList";

const sameLinks = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((link, index) => link === b[index]);

type AppearanceDraft = Omit<SessionAppearance, "approvedAt"> & {
  approvedAt: string | null;
  /** False until the reviewer has chosen this speaker's representations or an individual appearance. */
  reviewed: boolean;
};

/**
 * The identity the speaker chose on the proposal, read live, as the first
 * draft affiliation; the reviewer confirms or replaces it. Nothing is drafted
 * until the speaker has chosen.
 */
function sourceAffiliations(
  source: SessionProposalRepresentation | undefined,
  candidate: AgendaOccurrence["speakers"][number]["profileCandidate"],
): SessionAffiliation[] {
  return source?.selectedAt ? candidateAffiliations(candidate) : [];
}

/**
 * The reviewer approves each speaker's public credit for this session: one or more of the
 * speaker's representations (primary first) with the title shown for each, the biography,
 * portrait and profile links. The approved credit stays frozen with this event revision.
 */
export function AppearanceFields({
  appearances,
  speakers,
  sourceRepresentations,
  onChange,
  slug,
  occurrenceId,
}: {
  slug: string;
  occurrenceId: string;
  appearances: SessionAppearance[];
  speakers: AgendaOccurrence["speakers"];
  sourceRepresentations: SessionProposalRepresentation[];
  onChange: (value: SessionAppearance[]) => void;
}) {
  const [drafts, setDrafts] = useState<AppearanceDraft[]>(() =>
    speakers.map((speaker) => {
      const approved = appearances.find((appearance) => appearance.userId === speaker.userId);
      const source = sourceRepresentations.find((selection) => selection.userId === speaker.userId);
      return {
        userId: speaker.userId,
        displayName: approved?.displayName ?? speaker.displayName,
        affiliations: approved ? approved.affiliations : sourceAffiliations(source, speaker.profileCandidate),
        biography: approved
          ? approved.biography
          : source?.selectedAt
            ? (speaker.profileCandidate?.biography ?? "")
            : "",
        photoUrl: approved?.photoUrl ?? null,
        links: approved?.links ?? [],
        approvedAt: approved?.approvedAt ?? null,
        reviewed: Boolean(approved || source?.selectedAt),
      };
    }),
  );
  const [approvalError, setApprovalError] = useState("");
  const [offset, setOffset] = useState(0),
    [query, setQuery] = useState("");
  const catalog = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(occurrenceId)}/history/identities?limit=200&offset=${offset}&q=${encodeURIComponent(query)}`,
        sessionAppearanceChoicesSchema,
      ),
    [slug, occurrenceId, offset, query],
  );
  const update = (index: number, patch: Partial<AppearanceDraft>) => {
    setDrafts(drafts.map((value, i) => (i === index ? { ...value, ...patch, approvedAt: null } : value)));
    onChange(appearances.filter((appearance) => appearance.userId !== drafts[index]!.userId));
    setApprovalError("");
  };
  const updateAffiliation = (index: number, position: number, patch: Partial<SessionAffiliation>) =>
    update(index, {
      affiliations: drafts[index]!.affiliations.map((value, i) => (i === position ? { ...value, ...patch } : value)),
      reviewed: true,
    });
  const approve = (index: number) => {
    const { reviewed, ...draft } = drafts[index]!;
    if (!reviewed) {
      setApprovalError("Choose the representations this speaker appeared in, or an individual appearance, first.");
      return;
    }
    const checked = sessionAppearanceSchema.safeParse({ ...draft, approvedAt: new Date().toISOString() });
    if (!checked.success) {
      setApprovalError(checked.error.issues.map((issue) => issue.message).join(" "));
      return;
    }
    onChange([...appearances.filter((appearance) => appearance.userId !== checked.data.userId), checked.data]);
    setDrafts(drafts.map((value, i) => (i === index ? { ...checked.data, reviewed: true } : value)));
    setApprovalError("");
  };
  const pageControls = offset > 0 || Boolean(catalog.data?.page.hasMore);
  return (
    <section class="pk-stack" aria-label="Speaker representation">
      <p class="pk-muted">
        These credits stay attached to this event revision when a speaker later changes organization or profile.
      </p>
      {catalog.error && <ErrorAlert error={catalog.error} />}
      {approvalError && <ErrorAlert error={approvalError} />}
      <Field label="Find acting representation">
        {(control) => (
          <TextInput
            {...control}
            type="search"
            value={query}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setOffset(0);
            }}
          />
        )}
      </Field>
      {pageControls && (
        <div class="pk-cluster">
          <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 200))}>
            Previous identities
          </Button>
          <Button disabled={!catalog.data?.page.hasMore} onClick={() => setOffset(offset + 200)}>
            Next identities
          </Button>
        </div>
      )}
      {drafts.map((person, index) => {
        const profileCandidate = speakers.find((speaker) => speaker.userId === person.userId)?.profileCandidate;
        const current = catalog.data?.portraits.find((candidate) => candidate.userId === person.userId);
        const currentPortrait = current?.photoUrl ?? profileCandidate?.photoUrl;
        const profileLinks = current?.links ?? [];
        const available =
          person.affiliations.length >= MAX_SESSION_AFFILIATIONS
            ? []
            : (catalog.data?.identities ?? []).filter(
                (item) =>
                  item.userId === person.userId &&
                  !person.affiliations.some((affiliation) => affiliation.identityId === item.id),
              );
        return (
          <FormSection
            key={person.userId}
            title={person.displayName}
            description={person.approvedAt ? "Representation approved" : "Representation needs review"}
          >
            <FormSection
              title="Representations at this event"
              layout="stack"
              description="The capacities this speaker appeared in on the session date, primary first."
            >
              {person.affiliations.length === 0 ? (
                <p class="pk-muted">
                  {person.reviewed ? "Individual appearance without an affiliation." : "Representation needs review."}
                </p>
              ) : null}
              {person.affiliations.map((affiliation, position) => (
                <div class="pk-stack pk-stack--snug" key={affiliation.identityId ?? `source-${position}`}>
                  <strong>
                    {position === 0 ? "Primary: " : ""}
                    {affiliation.organizationName ?? "Individual"}
                  </strong>
                  <Field label="Title at this event">
                    {(control) => (
                      <TextInput
                        {...control}
                        value={affiliation.title ?? ""}
                        onInput={(e) => updateAffiliation(index, position, { title: e.currentTarget.value || null })}
                      />
                    )}
                  </Field>
                  {affiliation.organizationId === null ? (
                    <Field label="Organization at this event">
                      {(control) => (
                        <TextInput
                          {...control}
                          value={affiliation.organizationName ?? ""}
                          onInput={(e) =>
                            updateAffiliation(index, position, { organizationName: e.currentTarget.value || null })
                          }
                        />
                      )}
                    </Field>
                  ) : null}
                  <div class="pk-cluster">
                    {position > 0 ? (
                      <Button
                        onClick={() =>
                          update(index, {
                            affiliations: [affiliation, ...person.affiliations.filter((_value, i) => i !== position)],
                            reviewed: true,
                          })
                        }
                      >
                        Make primary
                      </Button>
                    ) : null}
                    <Button
                      onClick={() =>
                        update(index, {
                          affiliations: person.affiliations.filter((_value, i) => i !== position),
                          reviewed: true,
                        })
                      }
                    >
                      Remove {affiliation.organizationName ?? "affiliation"}
                    </Button>
                  </div>
                </div>
              ))}
              <Field
                label="Add a representation"
                help="Choose each of this speaker's identities they appeared in, or an individual appearance."
              >
                {(control) => (
                  <Select
                    {...control}
                    value=""
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      if (value === "__individual") {
                        update(index, { affiliations: [], links: profileLinks, reviewed: true });
                        return;
                      }
                      if (value === "__credited") {
                        // A capacity the program credited that no identity of the speaker records.
                        update(index, {
                          affiliations: [
                            ...person.affiliations,
                            { identityId: null, title: null, organizationId: null, organizationName: null },
                          ],
                          reviewed: true,
                        });
                        return;
                      }
                      const identity = available.find((item) => item.id === value);
                      if (!identity) return;
                      const affiliation: SessionAffiliation = {
                        identityId: identity.id,
                        title: identity.jobTitle,
                        organizationId: identity.organizationId,
                        organizationName: identity.organizationName,
                      };
                      const first = person.affiliations.length === 0;
                      update(index, {
                        affiliations: [...person.affiliations, affiliation],
                        reviewed: true,
                        // The primary representation brings its biography and links, as a single one always did.
                        ...(first ? { biography: identity.biography, links: identity.links } : {}),
                      });
                    }}
                  >
                    <option value="">Choose a representation</option>
                    <option value="__individual">Individual appearance (no affiliation)</option>
                    {person.affiliations.length < MAX_SESSION_AFFILIATIONS ? (
                      <option value="__credited">Another organization, as credited at the time</option>
                    ) : null}
                    {available.map((item) => (
                      <option value={item.id} key={item.id}>
                        {[item.organizationName ?? "Individual", item.jobTitle].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </FormSection>
            <Field label="Display name">
              {(control) => (
                <TextInput
                  {...control}
                  value={person.displayName}
                  onInput={(e) => update(index, { displayName: e.currentTarget.value })}
                />
              )}
            </Field>
            <Field label="Approved biography">
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  value={person.biography}
                  onInput={(e) => update(index, { biography: e.currentTarget.value })}
                />
              )}
            </Field>
            <FormSection
              title="Portrait, links and approval"
              layout="stack"
              description="Changes stay a draft until you approve this appearance and save."
            >
              <Field label="Approved portrait URL">
                {(control) => (
                  <TextInput
                    {...control}
                    value={person.photoUrl ?? ""}
                    onInput={(e) => update(index, { photoUrl: e.currentTarget.value || null })}
                  />
                )}
              </Field>
              {person.links.length > 0 ? (
                <LinkList links={person.links} ownerName={person.displayName} label="Published profile links" compact />
              ) : (
                <p class="pk-muted">No profile links are published with this appearance.</p>
              )}
              <div class="pk-cluster">
                {person.photoUrl && <Avatar name={person.displayName} src={person.photoUrl} size="sm" />}
                {currentPortrait && currentPortrait !== person.photoUrl && (
                  <Avatar name={person.displayName} src={currentPortrait} size="sm" />
                )}
                {currentPortrait && (
                  <Button
                    disabled={currentPortrait === person.photoUrl}
                    onClick={() => update(index, { photoUrl: currentPortrait })}
                  >
                    Use current portrait
                  </Button>
                )}
                {profileLinks.length > 0 && (
                  <Button
                    disabled={sameLinks(profileLinks, person.links)}
                    onClick={() => update(index, { links: profileLinks })}
                  >
                    Use profile links
                  </Button>
                )}
                {person.links.length > 0 && (
                  <Button onClick={() => update(index, { links: [] })}>Publish no links</Button>
                )}
                {profileCandidate?.biography && (
                  <Button
                    disabled={person.biography === profileCandidate.biography}
                    onClick={() => update(index, { biography: profileCandidate.biography ?? "" })}
                  >
                    Use profile biography
                  </Button>
                )}
              </div>
              <div class="pk-cluster">
                <Button variant="primary" onClick={() => approve(index)}>
                  Approve representation for {person.displayName}
                </Button>
              </div>
            </FormSection>
          </FormSection>
        );
      })}
    </section>
  );
}
