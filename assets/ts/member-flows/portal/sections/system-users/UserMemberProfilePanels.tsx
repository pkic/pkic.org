/**
 * The member-profile panels on a person's record: what they are vouched for,
 * what they are open to, and the standing they have earned.
 *
 * Each fetches its own resource, because each is governed differently and any
 * one of them may be absent — a member with no skills, availability set to
 * private, standing not yet earned. A panel that has nothing to say renders
 * nothing at all rather than an empty shell claiming a feature that has no
 * content behind it.
 *
 * They live here rather than in `UserDetail` so that file stays the record's
 * composition instead of also being three data-loading surfaces.
 */
import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";

import {
  memberAvailabilityResponseSchema,
  memberSkillsResponseSchema,
  memberStandingResponseSchema,
  type MemberAvailability,
  type MemberSkill,
  type MemberStanding,
} from "../../../../../shared/schemas/member-profile";
import { deleteJson, getJson, postJson } from "../../../../shared/api-client";
import { friendlyErrorMessage } from "../../../../components/ErrorAlert";
import { fmtDate, toast } from "../../ui";
import { Badge } from "../../../../ui/Badge";
import { ButtonLink } from "../../../../ui/Button";
import { Chip } from "../../../../ui/Chip";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { Menu } from "../../../../ui/Menu";
import { Meter } from "../../../../ui/Meter";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { UserAvailabilityEditor } from "./UserAvailabilityEditor";

/**
 * Loads one record-scoped resource, treating a failure as "nothing to show".
 *
 * A record still reads without its standing or its skills; a panel that cannot
 * load is one panel missing, never a page that fails. The response is parsed
 * through its shared schema by `getJson`, so a contract drift surfaces as a
 * missing panel here rather than as a wrong number on screen.
 */
function useRecordResource<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
  enabled: boolean,
): z.output<Schema> | null {
  const [value, setValue] = useState<z.output<Schema> | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void getJson(url, schema)
      .then((data) => {
        if (!cancelled) setValue(data);
      })
      .catch(() => {
        if (!cancelled) setValue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [url, schema, enabled]);
  return value;
}

export function MemberSkillsPanel({
  userId,
  canRead,
  canVouch = true,
}: {
  userId: string;
  canRead: boolean;
  /**
   * Whether the reader may vouch for these skills.
   *
   * False on the reader's own record: nobody vouches for themselves, which the
   * write path refuses. A chip that only ever answers with that refusal reads
   * as a broken control rather than as a rule.
   */
  canVouch?: boolean;
}) {
  const loaded = useRecordResource(
    `/api/v1/users/${encodeURIComponent(userId)}/skills`,
    memberSkillsResponseSchema,
    canRead,
  );
  /*
   * The panel holds its own copy once loaded, because vouching rewrites it:
   * both endpoints answer with the whole skill set, so the reply replaces
   * this rather than the panel re-deriving a count it did not compute.
   */
  const [edited, setEdited] = useState<z.output<typeof memberSkillsResponseSchema> | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const result = edited ?? loaded;
  const skills: MemberSkill[] = result?.skills ?? [];

  async function toggleVouch(skill: MemberSkill) {
    setPending(skill.skillId);
    const url = `/api/v1/users/${encodeURIComponent(userId)}/skills/${encodeURIComponent(skill.skillId)}/vouches`;
    try {
      // The reply carries the recounted set, so no optimistic count is invented
      // here — a refused vouch simply leaves the panel as it was.
      setEdited(
        skill.vouchedByViewer
          ? await deleteJson(url, memberSkillsResponseSchema)
          : await postJson(url, {}, memberSkillsResponseSchema),
      );
    } catch (cause) {
      // A refusal is the rule working — you cannot vouch for yourself, or for
      // somebody you share no group with. Say so rather than failing silently.
      toast(friendlyErrorMessage((cause as Error).message), "error");
    } finally {
      setPending(null);
    }
  }

  if (skills.length === 0) return null;

  // Strength is relative to the most-vouched skill, so a shelf reads as a
  // ranking rather than as an absolute score nobody can calibrate.
  const top = skills[0]?.vouchCount ?? 0;

  return (
    <Panel aria-label="Skills">
      <PanelHeader title="Skills">
        <span class="pk-small pk-muted">
          {skills.length} {skills.length === 1 ? "skill" : "skills"} · {result?.totalVouches ?? 0} vouches
        </span>
      </PanelHeader>
      <PanelBody>
        <div class="pk-cluster">
          {skills.map((skill) => (
            <Chip
              key={skill.skillId}
              count={skill.vouchCount}
              strength={top === 0 ? 0 : skill.vouchCount / top}
              pressed={canVouch ? skill.vouchedByViewer : undefined}
              onToggle={canVouch && pending === null ? () => void toggleVouch(skill) : undefined}
            >
              {skill.name}
            </Chip>
          ))}
        </div>
        <p class="pk-small pk-muted pk-footnote">
          {canVouch
            ? "Fill shows how many members vouched; only members who share a group can vouch."
            : "Fill shows how many members vouched. Nobody vouches for their own skills."}
        </p>
      </PanelBody>
    </Panel>
  );
}

/**
 * A comma-separated free-text field as the list it describes.
 *
 * Roles and services are written by the member in one input, which is the
 * right control for the job — but printed verbatim they are a run-on line.
 * Split here rather than stored split: the field is one sentence to whoever
 * typed it, and a list table for three strings would be a schema for nothing.
 */
function listOf(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function MemberAvailabilityPanel({
  userId,
  canRead,
  canWrite = false,
  contactEmail,
}: {
  userId: string;
  canRead: boolean;
  canWrite?: boolean;
  /** Where the call to action leads. Absent on a record with no address. */
  contactEmail?: string;
}) {
  const loaded = useRecordResource(
    `/api/v1/users/${encodeURIComponent(userId)}/availability`,
    memberAvailabilityResponseSchema,
    canRead,
  );
  const [saved, setSaved] = useState<MemberAvailability | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  // `undefined` means "not edited this session"; `null` is a real saved value.
  const availability: MemberAvailability | null = saved === undefined ? (loaded?.availability ?? null) : saved;

  const stated = availability !== null && (availability.openToEmployment || availability.openToContract);

  // Null covers both "said nothing" and "not visible to you" — the panel is
  // absent either way for a reader who cannot edit, which is what keeps the
  // two indistinguishable. Someone who may edit always gets the panel, because
  // to them an empty one is an invitation rather than a leak.
  if (!stated && !canWrite) return null;

  if (editing) {
    return (
      <Panel aria-label="Availability">
        <PanelHeader title="Availability" />
        <PanelBody>
          <UserAvailabilityEditor
            userId={userId}
            availability={availability}
            onSaved={(next) => {
              setSaved(next);
              setEditing(false);
            }}
          />
        </PanelBody>
      </Panel>
    );
  }

  const settingsMenu = (
    <Menu
      label="Availability settings"
      align="end"
      items={[
        {
          id: "edit",
          label: stated ? "Edit availability…" : "Set availability…",
          onSelect: () => {
            setEditing(true);
          },
        },
      ]}
    />
  );

  if (!stated) {
    return (
      <Panel aria-label="Availability">
        {/* The action is in the panel's own menu rather than a button in its
            body: a sidebar of panels each offering a control is a sidebar of
            buttons, and only one of them is ever the reason someone came. */}
        <PanelHeader title="Availability">{canWrite && settingsMenu}</PanelHeader>
        <PanelBody>
          <p class="pk-small pk-muted">Nothing stated. Members cannot see anything here until it is set.</p>
        </PanelBody>
      </Panel>
    );
  }

  /*
   * The two states are answered separately, because they are usually
   * alternatives: someone is looking for a job, or they are selling their
   * time, and the terms of one say nothing about the other. Rendering them as
   * two headings over one shared line claimed the roles applied to both.
   */
  const offers = [
    availability.openToEmployment
      ? { key: "employment", title: "Open to employment", tone: "pk-ok-note", items: listOf(availability.rolesSought) }
      : null,
    availability.openToContract
      ? {
          key: "contract",
          title: "Available for contract work",
          tone: "pk-info-note",
          items: listOf(availability.servicesOffered),
        }
      : null,
  ].filter((offer): offer is NonNullable<typeof offer> => offer !== null);

  /*
   * The conditions on the offer, shared by both: where the person will work
   * and from when. One line, so an absent value shortens the sentence instead
   * of leaving a gap where a paragraph would have been.
   */
  const conditions = [
    availability.note,
    availability.availableFrom ? `available from ${fmtDate(availability.availableFrom)}` : null,
  ].filter((part): part is string => Boolean(part));

  return (
    <Panel aria-label="Availability">
      <PanelHeader title="Availability">{canWrite && settingsMenu}</PanelHeader>
      {/*
        Tinted, because this is a standing rather than a list: it is the one
        thing on the record a reader may have come to act on. The words carry
        it regardless — the tint only stops it reading as another field set.
      */}
      <PanelBody tone="ok" class="pk-stack pk-stack--snug">
        {offers.map((offer, index) => (
          /* The rule separates the second offer from the first, the way the
             design does — the two are distinct claims, not one paragraph. */
          <div
            key={offer.key}
            class={index === 0 ? "pk-stack pk-stack--tight" : "pk-stack pk-stack--tight pk-footnote"}
          >
            <span class={`pk-strong ${offer.tone}`}>{offer.title}</span>
            {offer.items.length > 0 && (
              <ul class="pk-inline-list pk-small">
                {offer.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        ))}

        {conditions.length > 0 && <p class="pk-small pk-muted">{conditions.join(" · ")}</p>}

        {/*
          The design's call to action. It opens the reader's own mail client
          rather than a portal conversation, because there is no messaging
          domain yet — and a link that genuinely reaches the person is worth
          more than a button that waits for one.
        */}
        {contactEmail && (
          <ButtonLink
            variant="primary"
            size="sm"
            block
            href={`mailto:${contactEmail}?subject=${encodeURIComponent(
              availability.openToEmployment ? "About a role" : "About an engagement",
            )}`}
          >
            {availability.openToEmployment ? "Contact about a role" : "Enquire about an engagement"}
          </ButtonLink>
        )}

        {/*
          Who this reaches is a setting, so it is stated only to someone who
          can change it. To everyone else it is noise at best — they are
          reading the offer, not administering it — and at worst it advertises
          that the record has visibility rules to probe.
        */}
        {canWrite && (
          <p class="pk-small pk-muted">
            {availability.visibility === "members" ? "Shared with signed-in members" : "Visible only to you"}
          </p>
        )}
      </PanelBody>
    </Panel>
  );
}

export function MemberStandingPanel({ userId, canRead }: { userId: string; canRead: boolean }) {
  const result = useRecordResource(
    `/api/v1/users/${encodeURIComponent(userId)}/standing`,
    memberStandingResponseSchema,
    canRead,
  );
  const standing: MemberStanding | null = result?.standing ?? null;
  // Someone who has earned nothing yet has no standing to state. Showing
  // "level 1, 0 points" reads as a judgement rather than as an absence.
  if (!standing || (standing.points === 0 && standing.recognitions.length === 0)) return null;

  return (
    <Panel stripe aria-label="Standing">
      <PanelHeader title="Standing" />
      <PanelBody tone="accent">
        <div class="pk-stack pk-stack--tight">
          <div class="pk-cluster pk-cluster--between">
            <span class="pk-strong">
              {standing.levelName} · level {standing.level}
            </span>
            <span class="pk-small pk-muted">{standing.points} pts</span>
          </div>

          {standing.nextLevelAt !== null && (
            <Meter
              label={`Progress to level ${String(standing.level + 1)}`}
              value={standing.points}
              max={standing.nextLevelAt}
              tone="accent"
            />
          )}

          {standing.pointsToNextLevel !== null && (
            <p class="pk-small pk-muted">
              {standing.pointsToNextLevel} points to the next level. Points come from attendance, authorship, review and
              chairing — never from posting volume.
            </p>
          )}

          {standing.recognitions.length > 0 && (
            <div class="pk-cluster pk-footnote">
              {standing.recognitions.map((recognition) => (
                <Badge key={recognition.key} tone="accent">
                  {recognition.label}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

/**
 * What of this record is visible to whom — a settings panel, shown only to
 * someone who may change the settings.
 *
 * States only the controls that exist. The profile design also lists
 * Attendance, Contact and Directory visibility; nothing in the schema backs
 * those, and a row reading "Public" that no code enforces is worse than an
 * absent one — it is a promise about someone's personal data that the system
 * does not keep.
 */
export function MemberPrivacyPanel({
  identities,
  availability,
  canWrite = false,
}: {
  identities: readonly { identityId: string; organizationName: string | null; showOnOrgProfile: boolean }[];
  availability: MemberAvailability | null;
  /**
   * Whether the reader may change these settings.
   *
   * The panel is absent otherwise. It states no fact about the person — only
   * how the record is configured — so to a reader who cannot change it, it is
   * a list of switches they are not holding. Keeping it out also stops the
   * record advertising which of its parts are withheld and from whom.
   */
  canWrite?: boolean;
}) {
  const onOrgProfiles = identities.filter((identity) => identity.organizationName !== null);
  if (!canWrite) return null;
  if (onOrgProfiles.length === 0 && !availability) return null;

  const items = onOrgProfiles.map((identity) => ({
    term: identity.organizationName ?? "Organization",
    value: identity.showOnOrgProfile ? "Listed on the organization page" : "Not listed",
  }));

  items.push({
    term: "Availability",
    value:
      availability === null
        ? "Not stated"
        : availability.visibility === "members"
          ? "Signed-in members"
          : "Only this person",
  });

  return (
    <Panel aria-label="Visibility">
      <PanelHeader title="Visibility" />
      <PanelBody>
        <DescriptionList density="compact" items={items} />
        <p class="pk-small pk-muted pk-footnote">
          Group rosters always show a member&rsquo;s name to that group, whatever is set here.
        </p>
      </PanelBody>
    </Panel>
  );
}
