/**
 * Links that subscribe a calendar app to an iCalendar feed. The feed keeps updating in the app, unlike a
 * downloaded file. One place owns each provider's deep-link format so every screen offers the same set.
 *
 * Formats follow the providers' "subscribe from web" flows as used by the widely deployed
 * add-to-calendar-button library: Google takes the `webcal:` address in `cid`, Outlook.com and
 * Microsoft 365 take it in `url` with a display `name`, and Apple Calendar opens `webcal:` directly.
 */
export const calendarSubscriptionProviders = ["google", "outlook-com", "microsoft-365", "apple"] as const;
export type CalendarSubscriptionProvider = (typeof calendarSubscriptionProviders)[number];

export const calendarSubscriptionProviderDetails = {
  google: { label: "Google Calendar", hint: "Gmail and Android", opensInBrowser: true },
  "outlook-com": { label: "Outlook.com", hint: "Personal Microsoft account", opensInBrowser: true },
  "microsoft-365": { label: "Microsoft 365", hint: "Outlook for work or school", opensInBrowser: true },
  apple: { label: "Apple Calendar", hint: "iPhone, iPad, and Mac", opensInBrowser: false },
} as const satisfies Record<CalendarSubscriptionProvider, { label: string; hint: string; opensInBrowser: boolean }>;

/** The same feed addressed as a subscription, which calendar apps refresh instead of importing once. */
export function webcalUrl(feedUrl: string): string {
  const url = new URL(feedUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("A calendar feed must be a web address.");
  return `webcal:${url.href.slice(url.protocol.length)}`;
}

export function calendarSubscriptionLink(
  provider: CalendarSubscriptionProvider,
  feedUrl: string,
  name: string,
): string {
  const webcal = webcalUrl(feedUrl);
  // Percent-encoding, not form encoding: Outlook reads a `+` in the name literally.
  const subscribe = `url=${encodeURIComponent(webcal)}&name=${encodeURIComponent(name)}`;
  switch (provider) {
    case "google":
      return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`;
    case "outlook-com":
      return `https://outlook.live.com/calendar/0/addfromweb?${subscribe}`;
    case "microsoft-365":
      return `https://outlook.office.com/calendar/0/addfromweb?${subscribe}`;
    case "apple":
      return webcal;
  }
}

/**
 * The downloadable iCalendar file of a group's meeting series. `personal` scopes it to the reader's own
 * invitations; `occurrenceId` narrows it to a single meeting.
 */
export function meetingSeriesCalendarPath(
  groupId: string,
  seriesId: string,
  options: { personal?: boolean; occurrenceId?: string } = {},
): string {
  const path = `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(seriesId)}/calendar.ics`;
  const query = new URLSearchParams();
  if (options.personal) query.set("personal", "true");
  if (options.occurrenceId) query.set("occurrenceId", options.occurrenceId);
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

/** The downloadable iCalendar file of one registration's personal event schedule. */
export function registrationCalendarPath(eventSlug: string, registrationId: string): string {
  return `/api/v1/events/${encodeURIComponent(eventSlug)}/registrations/${encodeURIComponent(registrationId)}/calendar.ics`;
}
