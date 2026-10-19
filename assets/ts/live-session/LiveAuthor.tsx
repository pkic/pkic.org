import { createContext, type ComponentChildren } from "preact";
import { useContext, useRef } from "preact/hooks";
import type { LiveAuthorRole } from "../../shared/live-author-roles";
import type { LiveAuthorAffiliation, LiveAuthorDetails } from "../../shared/schemas/live-session-author";
import type { LiveRoomClientMessage } from "../../shared/schemas/live-session-room";
import { usePersonCard, type Person } from "../site/PersonCard";
import { RoleMarks } from "../site/RoleMarks";
import "./LiveAuthor.css";

/** The room's author cards, and how to ask for one, for every name inside a live room view. */
export interface LiveAuthorLookup {
  authors: Readonly<Record<string, LiveAuthorDetails | null>>;
  lookup: (handle: string) => void;
}
export const LiveAuthorContext = createContext<LiveAuthorLookup | null>(null);

/**
 * Provides author cards from the room's state and connection. Each handle is
 * asked for once; the room's answer arrives in the room state.
 */
export function LiveAuthorProvider({
  authors,
  send,
  children,
}: {
  authors: Readonly<Record<string, LiveAuthorDetails | null>> | undefined;
  send: (message: LiveRoomClientMessage) => boolean;
  children: ComponentChildren;
}) {
  const asked = useRef(new Set<string>());
  const lookup = (handle: string) => {
    if (asked.current.has(handle)) return;
    if (send({ type: "author.lookup", handle })) asked.current.add(handle);
  };
  return <LiveAuthorContext.Provider value={{ authors: authors ?? {}, lookup }}>{children}</LiveAuthorContext.Provider>;
}

/** The capacity beside a name: the organization, else the title. */
function affiliationText(affiliation: LiveAuthorAffiliation | null | undefined): string | null {
  return affiliation?.organization?.name ?? affiliation?.title ?? null;
}

/** An author as the person card shows them: their portrait, capacity, every role here and their profile. */
function authorPerson(details: LiveAuthorDetails): Person {
  return {
    name: details.name,
    photoUrl: details.photoUrl,
    affiliation: details.affiliation,
    roles: details.roles,
    profilePath: details.profilePath,
  };
}

/**
 * An author's name in a live room: the name, their capacity in muted type,
 * their highest role marks, and, for someone the room can resolve, the
 * person card on hover, on focus or on a tap. A name without a handle (an
 * anonymous question, someone the room cannot sign) is plain text.
 */
export function LiveAuthorName({
  name,
  handle,
  affiliation,
  roles = [],
  class: className,
}: {
  name: string;
  handle?: string | null;
  affiliation?: LiveAuthorAffiliation | null;
  roles?: readonly LiveAuthorRole[];
  class?: string;
}) {
  const room = useContext(LiveAuthorContext);
  const details = handle && room ? room.authors[handle] : undefined;
  const capacity = affiliationText(affiliation);
  const card = usePersonCard<HTMLButtonElement>({
    person: details ? authorPerson(details) : details,
    onShow: () => {
      if (handle && room && details === undefined) room.lookup(handle);
    },
  });

  return (
    <span class={["pk-live-author", className].filter(Boolean).join(" ")}>
      {handle && room ? (
        <button
          ref={card.anchorRef}
          type="button"
          class="pk-live-author__name"
          {...card.hoverProps}
          {...card.toggleProps}
        >
          {name}
        </button>
      ) : (
        <strong class="pk-live-author__name">{name}</strong>
      )}
      {capacity ? <span class="pk-live-author__capacity">{capacity}</span> : null}
      <RoleMarks roles={roles} />
      {card.card}
    </span>
  );
}
