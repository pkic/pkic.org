import type { ComponentChildren } from "preact";
import "../../design/tokens.agenda.generated.css";
import "./AgendaSessionRow.css";

/**
 * How a row's title opens the session: a link to its own page or route, and,
 * inside a rendered agenda, the occurrence whose details the agenda opens in
 * place (agenda.ts intercepts the link, so it still works without scripts).
 */
export interface AgendaSessionRowOpen {
  href?: string;
  occurrence?: string;
}

/**
 * One session as a compact row: when, the title that opens it, where, and the
 * reader's own marks at the end. Shared by My agenda and a speaker's session
 * list, so both read and open sessions the same way. The surrounding list
 * names the clock once; a row carries only the times.
 */
export function AgendaSessionRow({
  when,
  dateTime,
  title,
  open,
  room,
  details,
  actions,
}: {
  when: ComponentChildren;
  /** The start instant, for the row's `<time>`. */
  dateTime: string;
  title: string;
  open?: AgendaSessionRowOpen;
  room?: string | null;
  /** Quiet markers after the room, such as a speaker's role in the session. */
  details?: ComponentChildren;
  /** The reader's marks: a held seat and the star. */
  actions?: ComponentChildren;
}) {
  const occurrence = open?.occurrence;
  const name = open?.href ? (
    <a class="pk-agenda-session-row__title" href={open.href} data-agenda-open-occurrence={occurrence}>
      {title}
    </a>
  ) : occurrence ? (
    <button type="button" class="pk-agenda-session-row__title" data-agenda-open-occurrence={occurrence}>
      {title}
    </button>
  ) : (
    <span class="pk-agenda-session-row__title">{title}</span>
  );
  return (
    <li class="pk-agenda-session-row">
      <time class="pk-agenda-session-row__when" dateTime={dateTime}>
        {when}
      </time>
      <div class="pk-agenda-session-row__main">
        {name}
        {room || details ? (
          <div class="pk-agenda-session-row__meta">
            {room ? <span>{room}</span> : null}
            {details}
          </div>
        ) : null}
      </div>
      {actions ? <span class="pk-agenda-session-row__actions">{actions}</span> : null}
    </li>
  );
}

/** The clock a list's times are on, named once for the whole list. */
export function AgendaClockNote({ clock }: { clock: string }) {
  return <div class="pk-agenda-session-rows__clock">Times shown in {clock}</div>;
}

/** The rows of one list, with the clock they share named once when the list names it itself. */
export function AgendaSessionRows({ clock, children }: { clock?: string; children: ComponentChildren }) {
  return (
    <>
      {clock ? <AgendaClockNote clock={clock} /> : null}
      <ul class="pk-agenda-session-rows">{children}</ul>
    </>
  );
}
