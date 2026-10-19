/** Static links to approved public artifacts; never contains a personal subscription token. */
export function AgendaCalendarLinks({ links }: { links?: { downloadHref: string; subscribeHref: string } }) {
  if (!links) return null;
  return (
    <p aria-label="Public agenda calendar">
      <a href={links.subscribeHref}>Subscribe to calendar</a> ·{" "}
      <a href={links.downloadHref} download>
        Download calendar
      </a>
    </p>
  );
}
