import type { ComponentChildren, JSX, RefObject } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { LiveAuthorRole } from "../../shared/live-author-roles";
import type { LiveAuthorAffiliation } from "../../shared/schemas/live-session-author";
import { AgendaSpeakerAffiliations } from "./AgendaSpeakerAffiliations";
import { SpeakerPortraitCard } from "../ui/SpeakerPortraitCard";
import { usePopupPlacement } from "../ui/popup-placement";
import { RoleMarks } from "./RoleMarks";
import "./PersonCard.css";

/** Who someone is, as a live room's person card shows them to a reader who does not know them. */
export interface Person {
  name: string;
  photoUrl?: string | null;
  /** The title and organization of the identity they act as. */
  affiliation?: LiveAuthorAffiliation | null;
  /** Their part in this session in plain words, such as "Speaker" or "Added for this session". */
  sessionRole?: string | null;
  /** The room's roles for them, every one in full. */
  roles?: readonly LiveAuthorRole[];
  /** Their public profile page, when they have one. */
  profilePath?: string | null;
}

/** A title and organization as one affiliation, for people whose identity carries them as text. */
export function personAffiliation(
  title: string | null | undefined,
  organization: string | null | undefined,
): LiveAuthorAffiliation | null {
  if (!title && !organization) return null;
  return {
    ...(title ? { title } : {}),
    ...(organization ? { organization: { name: organization } } : {}),
  };
}

/**
 * The person card: their portrait large enough to recognize them, as on the
 * agenda's speaker directory, with their name, the title and organization
 * they act as, and their part in this session.
 */
export function PersonCard({ person }: { person: Person }) {
  return (
    <SpeakerPortraitCard name={person.name} imageSrc={person.photoUrl} label={person.name}>
      <span class="pk-agenda-speaker-directory__name">
        <strong>{person.profilePath ? <a href={person.profilePath}>{person.name}</a> : person.name}</strong>
      </span>
      <AgendaSpeakerAffiliations
        affiliations={person.affiliation ? [person.affiliation] : []}
        layout="directory"
        size="card"
      />
      {person.sessionRole ? <span class="pk-live-person-card__role">{person.sessionRole}</span> : null}
      {person.roles?.length ? <RoleMarks roles={person.roles} full /> : null}
    </SpeakerPortraitCard>
  );
}

/** Leaving a name for its card must not close it, so closing waits a moment. */
const CLOSE_DELAY_MS = 150;

/*
 * How focus last arrived. A tap or click also focuses what it lands on, and a
 * card opened by that focus would cover a name that is a link before the tap
 * could follow it; so focus opens the card only after a key press, as
 * `:focus-visible` does. Hover and a toggle's own tap open it for pointers.
 */
let focusFromKeyboard = true;
if (typeof document !== "undefined") {
  document.addEventListener("keydown", () => (focusFromKeyboard = true), true);
  document.addEventListener("pointerdown", () => (focusFromKeyboard = false), true);
}

export interface PersonCardHandle<Anchor extends HTMLElement> {
  /** The element the card hangs from. */
  anchorRef: RefObject<Anchor>;
  /** Opens the card on hover or keyboard focus anywhere inside the element that carries them. */
  hoverProps: Pick<JSX.HTMLAttributes<HTMLElement>, "onPointerEnter" | "onPointerLeave" | "onFocusIn" | "onFocusOut">;
  /** Makes a control open and close the card with a tap or a key press. */
  toggleProps: Pick<
    JSX.HTMLAttributes<HTMLButtonElement>,
    "onPointerDown" | "onClick" | "aria-expanded" | "aria-controls"
  >;
  /** The card, rendered beside its anchor while it is open. */
  card: ComponentChildren;
}

/**
 * One person card's behavior: it opens on hover and on keyboard focus, and a
 * tap on its toggle opens and closes it on a touch screen, while a tap on a
 * linked name follows the link; Escape, or a tap elsewhere,
 * closes it. The card sits in the top layer beside its anchor, sized to fit
 * a phone, and a reader can move into it to follow the profile link.
 */
export function usePersonCard<Anchor extends HTMLElement>({
  person,
  onShow,
  side = "bottom",
}: {
  /** Undefined while the person is still being looked up; the card waits for them. */
  person: Person | null | undefined;
  /** Called each time the card is asked for, such as to look the person up. */
  onShow?: () => void;
  side?: "bottom" | "right";
}): PersonCardHandle<Anchor> {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<Anchor>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef("mouse");
  const pointerStartedOpen = useRef<boolean | null>(null);
  const cardId = useId();
  const shown = open && Boolean(person);
  usePopupPlacement({ open: shown, anchorRef, popupRef, revision: person?.name, side, topLayer: true });

  const cancelClose = () => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
  };
  const show = () => {
    cancelClose();
    onShow?.();
    setOpen(true);
  };
  const hide = () => {
    cancelClose();
    closing.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  };
  useEffect(() => cancelClose, []);
  useLayoutEffect(() => {
    if (!open) return;
    // Escape belongs to the card first: it closes the card and nothing around it, such as a dialog or full screen.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    const elsewhere = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (anchorRef.current?.contains(target) || popupRef.current?.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener("keydown", escape, true);
    document.addEventListener("pointerdown", elsewhere);
    return () => {
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("pointerdown", elsewhere);
    };
  }, [open]);

  const hover = {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType !== "touch") show();
    },
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType !== "touch") hide();
    },
    onFocusIn: () => {
      if (focusFromKeyboard) show();
    },
    onFocusOut: hide,
  };
  return {
    anchorRef,
    hoverProps: hover,
    toggleProps: {
      "aria-expanded": shown ? "true" : "false",
      "aria-controls": shown ? cardId : undefined,
      onPointerDown: (event) => {
        pointer.current = event.pointerType;
        // Toggle from the gesture's starting state, whatever focus or hover did in between.
        pointerStartedOpen.current = shown;
      },
      onClick: (event) => {
        const wasShown = event.detail === 0 ? shown : (pointerStartedOpen.current ?? shown);
        pointerStartedOpen.current = null;
        // A tap or the keyboard opens and closes the card; a mouse already opened it on hover.
        if (event.detail !== 0 && pointer.current === "mouse") return;
        if (wasShown) setOpen(false);
        else show();
      },
    },
    card:
      shown && person ? (
        <div
          ref={popupRef}
          id={cardId}
          role="dialog"
          aria-label={`About ${person.name}`}
          class="pk-live-person-card"
          {...hover}
        >
          <PersonCard person={person} />
        </div>
      ) : null,
  };
}

/**
 * A region that shows a person's card on hover and keyboard focus, for a
 * control that does something else when pressed, such as picking a search result.
 */
export function PersonPreview({ person, children }: { person: Person; children: ComponentChildren }) {
  const preview = usePersonCard<HTMLSpanElement>({ person, side: "right" });
  return (
    <span ref={preview.anchorRef} class="pk-live-person-preview" {...preview.hoverProps}>
      {children}
      {preview.card}
    </span>
  );
}
