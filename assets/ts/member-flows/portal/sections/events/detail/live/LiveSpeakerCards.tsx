import { personRoleAt } from "../../../../../../../shared/person-display";
import "./LiveSpeakerCards.css";
import "./live-tally.css";
import { signal } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { LIVE_AUX_OUTPUTS } from "../../../../../../../shared/live-room-outputs";
import { LIVE_ADDED_CREDITS_MAX, liveCreditHasRole } from "../../../../../../../shared/live-room-credits";
import type { LiveCredit } from "../../../../../../../shared/schemas/live-session-room";
import { Avatar } from "../../../../../../ui/Avatar";
import { Button } from "../../../../../../ui/Button";
import { SectionHeading } from "../../../../../../ui/SectionHeading";
import { IconRemove } from "../../../../../../ui/MediaIcons";
import { LiveAddPersonDialog } from "./LiveAddPersonDialog";
import { StudioCreateAction } from "./studio/StudioCreateAction";
import { LiveLayerTargets } from "./LiveLayerTargets";
import { liveLayerTargets, sendLayerToggle, type LiveTargets } from "./live-output-targets";
import { livePresenceItem } from "./presence/live-presence";
import { personAffiliation, usePersonCard } from "../../../../../../site/PersonCard";

/** Set while this desk waits for the person it just added, so only its operator is taken to them. */
const awaitingAdded = signal(false);

/** Where a credit's lower third is now, for the tally edge of its row. */
function onAirOf(targets: LiveTargets, key: string) {
  const where = liveLayerTargets(targets, { kind: "lowerThird", key });
  return {
    where,
    onAir: where.program
      ? ("program" as const)
      : LIVE_AUX_OUTPUTS.some(where.aux)
        ? ("aux" as const)
        : where.preview
          ? ("preview" as const)
          : undefined,
  };
}

/**
 * One person as one compact row: their photo, name, and the role or identity
 * they appear as. Pressing the row lines their lower third up in Preview; the
 * outputs sit at the row's end. Every person, however many, reads the same.
 * Hovering or focusing the person, or tapping their photo, shows their card
 * with a large portrait, so an operator who has never met them knows who it is.
 */
function PersonRow({
  targets,
  credit,
  sessionRole,
  onRemove,
  rowRef,
}: {
  targets: LiveTargets;
  credit: LiveCredit;
  /** Their part in this session, as the card says it. */
  sessionRole: string;
  onRemove?: () => void;
  rowRef?: (node: HTMLLIElement | null) => void;
}) {
  const layer = { kind: "lowerThird" as const, key: credit.key };
  const { where, onAir } = onAirOf(targets, credit.key);
  const item = livePresenceItem(layer);
  const affiliation = personRoleAt({ title: credit.identity?.title, organization: credit.identity?.organization });
  const card = usePersonCard<HTMLLIElement>({
    person: {
      name: credit.name,
      photoUrl: credit.photoUrl,
      affiliation: personAffiliation(credit.identity?.title, credit.identity?.organization),
      sessionRole,
    },
    side: "right",
  });
  return (
    <li
      ref={(node) => {
        // The card hangs beside the whole row, so it never covers the row's own outputs.
        card.anchorRef.current = node;
        rowRef?.(node);
      }}
      class="pk-live-person"
      data-on-air={onAir}
      data-presence-item={item}
    >
      <div class="pk-live-person__who" {...card.hoverProps}>
        {/* The photo opens the card for a tap; the keyboard reaches it by focusing the person. */}
        <button type="button" class="pk-live-person__photo" tabIndex={-1} aria-hidden="true" {...card.toggleProps}>
          <Avatar name={credit.name} src={credit.photoUrl ?? undefined} size="md" alt="" />
        </button>
        <button
          type="button"
          class="pk-live-person__main"
          disabled={targets.disabled}
          aria-pressed={where.preview}
          aria-label={`Prepare ${credit.name} in Preview`}
          onClick={() => {
            if (!where.preview) sendLayerToggle(targets, layer, "preview");
          }}
        >
          <span class="pk-live-person__text">
            <strong>{credit.name}</strong>
            {credit.roleLabel ? <span class="pk-live-person__role">{credit.roleLabel}</span> : null}
            {affiliation ? <span>{affiliation}</span> : null}
          </span>
        </button>
        {card.card}
      </div>
      {/* The outputs name the other operators on this person, once. */}
      <LiveLayerTargets targets={targets} subject={credit.name} layer={layer} />
      {onRemove ? (
        <Button
          icon
          variant="ghost"
          aria-label={`Remove ${credit.name}`}
          title="Remove from this session"
          disabled={targets.disabled}
          onClick={onRemove}
        >
          <IconRemove />
        </Button>
      ) : null}
    </li>
  );
}

/** A person's part in this session, as their card says it. */
function sessionRoleOf(credit: LiveCredit, added: boolean): string {
  if (added) return "Added for this session";
  return liveCreditHasRole(credit) ? `${credit.roleLabel ?? "Moderator"} in this session` : "Speaker in this session";
}

/** A group of people with its heading, in the panel's reading order. */
function PeopleGroup({
  label,
  titled = true,
  children,
}: {
  label: string;
  /** False when the panel's own title already names the group. */
  titled?: boolean;
  children: ComponentChildren;
}) {
  return (
    <section class="pk-live-people__group" aria-label={label}>
      {titled ? (
        <SectionHeading level={4} class="pk-live-people__heading">
          {label}
        </SectionHeading>
      ) : null}
      <ul class="pk-live-people">{children}</ul>
    </section>
  );
}

/**
 * The session's people as lower thirds: the speakers, then the host and
 * moderator, then anyone operators added for this session, whom any
 * operator can remove again. Someone just added is scrolled into view and
 * focused, so the operator sees them where they landed. Bare, as on the
 * phone's Home, it is the rows alone: no group headings and nothing when
 * there is no one.
 */
export function LiveSpeakerCards({ targets, bare = false }: { targets: LiveTargets; bare?: boolean }) {
  const { session, addedCredits } = targets.state;
  const speakers = session.credits.filter((credit) => !liveCreditHasRole(credit));
  const supporting = session.credits.filter(liveCreditHasRole);
  const full = addedCredits.length >= LIVE_ADDED_CREDITS_MAX;
  const rows = useRef(new Map<string, HTMLLIElement>());
  const known = useRef(new Set(addedCredits.map((credit) => credit.key)));
  useEffect(() => {
    const arrived = addedCredits.filter((credit) => !known.current.has(credit.key));
    known.current = new Set(addedCredits.map((credit) => credit.key));
    const latest = arrived.at(-1);
    const row = latest ? rows.current.get(latest.key) : undefined;
    if (!row) return;
    // Only the operator who added them is taken there; the others keep their place and focus.
    if (!awaitingAdded.peek()) return;
    awaitingAdded.value = false;
    row.scrollIntoView({ block: "nearest" });
    row.querySelector<HTMLButtonElement>(".pk-live-person__main")?.focus({ preventScroll: true });
  }, [addedCredits]);
  const keep = (key: string) => (node: HTMLLIElement | null) => {
    if (node) rows.current.set(key, node);
    else rows.current.delete(key);
  };
  if (bare && !session.credits.length && !addedCredits.length) return null;
  return (
    <div class="pk-live-speakers">
      {speakers.length ? (
        <PeopleGroup label="Speakers" titled={false}>
          {speakers.map((credit) => (
            <PersonRow key={credit.key} targets={targets} credit={credit} sessionRole={sessionRoleOf(credit, false)} />
          ))}
        </PeopleGroup>
      ) : bare ? null : (
        <p class="pk-live-speakers__empty">No approved speaker credits.</p>
      )}
      {supporting.length ? (
        <PeopleGroup label="Host and moderator" titled={!bare}>
          {supporting.map((credit) => (
            <PersonRow key={credit.key} targets={targets} credit={credit} sessionRole={sessionRoleOf(credit, false)} />
          ))}
        </PeopleGroup>
      ) : null}
      {addedCredits.length ? (
        <PeopleGroup label="Added for this session" titled={!bare}>
          {addedCredits.map((credit) => (
            <PersonRow
              key={credit.key}
              targets={targets}
              credit={credit}
              sessionRole={sessionRoleOf(credit, true)}
              rowRef={keep(credit.key)}
              onRemove={() => targets.sendProgram({ type: "credit.remove", creditKey: credit.key })}
            />
          ))}
        </PeopleGroup>
      ) : null}
      {full && !bare ? <p class="pk-live-speakers__note">Remove someone to add another person.</p> : null}
    </div>
  );
}

/** The Speakers panel's create action: add someone to this session's lower thirds. */
export function LiveAddPersonAction({ targets, slug }: { targets: LiveTargets; slug: string }) {
  return (
    <StudioCreateAction
      label="Add person"
      disabled={targets.disabled || targets.state.addedCredits.length >= LIVE_ADDED_CREDITS_MAX}
    >
      {(close) => (
        <LiveAddPersonDialog
          slug={slug}
          listed={
            new Set([...targets.state.session.credits, ...targets.state.addedCredits].map((credit) => credit.key))
          }
          onAdd={(person) => {
            const sent = targets.sendProgram({ type: "credit.add", person });
            if (sent) awaitingAdded.value = true;
            return sent;
          }}
          onClose={close}
        />
      )}
    </StudioCreateAction>
  );
}
