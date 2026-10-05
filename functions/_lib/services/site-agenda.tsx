import { agendaContent } from "../../../assets/shared/public-agenda-content";
import { eventParticipationLink } from "../../../assets/shared/event-participation-link";
import { agendaDisplayRoles } from "../../../assets/shared/event-agenda-display-roles";
import { publishedSessionHistory } from "./site-session-history";
import { httpOrSameOriginUrlSchema } from "../../../assets/shared/schemas/urls";
import { applyApprovedAgenda } from "./site-approved-agenda";
import { normalizeLinks } from "../../../assets/shared/schemas/links";
import { renderToStringAsync as render } from "preact-render-to-string";
import { ContentAgenda } from "../../../assets/ts/site/ContentAgenda";
import type { ContentComponentContext } from "./site-components";
import { conferenceLocation } from "./site-conference-location";
import { publishedConferenceProgram } from "./site-conference-program";
import {
  authoredAgendaSessionFragments,
  authoredAgendaDayFragments,
  authoredAgendaSpeakerFragments,
} from "../../../assets/shared/legacy-agenda-fragments";

function agendaPresentationUrl(
  value: string | undefined,
  eventAssets: ContentComponentContext["assetUrls"],
): string | undefined {
  if (!value) return undefined;
  const direct = httpOrSameOriginUrlSchema.safeParse(value);
  if (direct.success) return direct.data;
  const resolved = httpOrSameOriginUrlSchema.safeParse(eventAssets(value)[0]);
  return resolved.success ? resolved.data : undefined;
}

export async function renderContentAgenda(
  context: ContentComponentContext,
  markdownHtml: (value: unknown) => Promise<string>,
): Promise<string> {
  const approved = context.publication?.eventAgendas?.[context.eventSlug ?? ""];
  if (approved) {
    const content = agendaContent(approved);
    return await render(
      <ContentAgenda
        days={content.days}
        speakers={content.speakers}
        timeZone={approved.timeZone}
        legacySpeakerFragments={content.legacySpeakerFragments}
        fragmentNavigation
      />,
    );
  }
  if (!context.eventData?.agenda) return "";
  const eventAssets = context.eventAssetUrls ?? context.assetUrls;
  const program = applyApprovedAgenda(
    publishedConferenceProgram(context.eventData, eventAssets),
    context.publication?.eventAgendas?.[context.eventSlug ?? ""],
  );
  const archives: Map<string, ReturnType<typeof publishedSessionHistory>[number]> = context.publication
    ? new Map(
        publishedSessionHistory(context.publication).map((item) => [
          `${item.agenda.eventSlug}/${item.session.id}`,
          item,
        ]),
      )
    : new Map();
  const rawAgenda = program.agenda;
  const authoredAgenda = context.eventData.agenda as Record<
    string,
    Array<{ time: string; sessions?: Array<{ title?: string | null }> }>
  >;
  const legacySpeakerFragments = Object.keys(rawAgenda).length > 1 ? authoredAgendaSpeakerFragments : [];
  const approvedIds = new Set(
    context.publication?.eventAgendas?.[context.eventSlug ?? ""]?.occurrences.map((item) => item.id) ?? [],
  );
  const approvedSessions = new Map(
    context.publication?.eventAgendas?.[context.eventSlug ?? ""]?.occurrences.map((item) => [item.id, item]) ?? [],
  );
  const timeZone = program.timezone;
  const rawLocations = program.locations;
  const locationOrder = Array.isArray(rawLocations.order) ? rawLocations.order.map(String) : [];
  const rawSpeakers = program.speakers;
  const speakers = await Promise.all(
    rawSpeakers.map(async (speaker) => {
      return {
        bioHtml: await markdownHtml(speaker.bio),
        imageSrc: speaker.headshot?.x250,
        links: normalizeLinks([speaker.website, ...Object.values(speaker.social ?? {})]).links,
        name: speaker.name,
        title: speaker.title ?? undefined,
      };
    }),
  );
  const speakerByName = new Map(speakers.map((speaker) => [speaker.name, speaker]));
  const days = await Promise.all(
    Object.entries(rawAgenda)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(async ([date, slots]) => {
        const dayDefinition = rawLocations[date];
        const dayLocations =
          dayDefinition && typeof dayDefinition === "object" && !Array.isArray(dayDefinition)
            ? (dayDefinition as Record<string, unknown>)
            : {};
        const order = Array.isArray(dayLocations.order) ? dayLocations.order.map(String) : locationOrder;
        const sessionLocations = slots.flatMap((slot) => slot.sessions.flatMap((session) => session.locations));
        const roomIds = [...new Set([...order, ...sessionLocations])];
        if (!roomIds.length) roomIds.push("sessions");
        return {
          date,
          legacyFragments: authoredAgendaDayFragments(date).filter(
            (fragment) => fragment.kind === "day" || Object.keys(rawAgenda).length > 1,
          ),
          staffing: context.publication?.eventAgendas?.[context.eventSlug ?? ""]
            ? agendaDisplayRoles(context.publication.eventAgendas[context.eventSlug ?? ""], date, true)
            : [],
          locations: roomIds.map((id) => ({ id, label: conferenceLocation(program, date, id).name })),
          slots: await Promise.all(
            slots.map(async (slot, slotIndex) => {
              return {
                startsAt: slot.startsAt,
                durationMinutes: slot.durationMinutes,
                sessions: await Promise.all(
                  slot.sessions.map(async (session, sessionIndex) => {
                    const approvedSession = approvedSessions.get(session.id ?? "");
                    const presentationUrl = agendaPresentationUrl(session.presentation, eventAssets);
                    const originalTitle = authoredAgenda[date]?.[slotIndex]?.sessions?.[sessionIndex]?.title ?? null;
                    const authoredOrder = Array.isArray(dayLocations.order)
                      ? dayLocations.order.map(String)
                      : locationOrder;
                    const legacyPresentationUrl =
                      presentationUrl?.startsWith("/content-media/events/") &&
                      session.presentation &&
                      decodeURIComponent(presentationUrl.slice(presentationUrl.lastIndexOf("/") + 1)) ===
                        session.presentation
                        ? presentationUrl.replace(/^\/content-media/u, "")
                        : undefined;
                    return {
                      id: session.id,
                      publicAnchor: session.publicAnchor,
                      legacyFragments: authoredAgendaSessionFragments(
                        slot.time,
                        originalTitle,
                        session.locations,
                        authoredOrder,
                      ),
                      descriptionHtml: approvedIds.has(session.id ?? "") ? "" : await markdownHtml(session.description),
                      descriptionMarkdown: approvedIds.has(session.id ?? "") ? (session.description ?? "") : undefined,
                      durationMinutes: session.durationMinutes,
                      endsAt: session.endsAt,
                      locations: session.locations,
                      participation:
                        approvedSession && approvedSession.kind !== "break" && context.eventSlug
                          ? eventParticipationLink(
                              context.eventSlug,
                              approvedSession.id,
                              approvedSession.admissionPolicy,
                              approvedSession.accessPolicy,
                            )
                          : undefined,
                      sessionUrl: archives.get(`${context.eventSlug}/${session.id}`)?.route,
                      presentationUrl,
                      legacyPresentationUrl,
                      speakers: archives.get(`${context.eventSlug}/${session.id}`)?.appearances.length
                        ? await Promise.all(
                            archives.get(`${context.eventSlug}/${session.id}`)!.appearances.map(async (credit) => ({
                              name: credit.displayName,
                              title: [credit.jobTitle, credit.organizationName].filter(Boolean).join(" · "),
                              bioHtml: await markdownHtml(credit.biography),
                              imageSrc: credit.photoUrl ?? undefined,
                              links: [],
                            })),
                          )
                        : session.speakers.map((name) => ({
                            ...(speakerByName.get(name.replace(/ \*$/, "")) ?? { name: name.replace(/ \*$/, "") }),
                            moderator: name.endsWith(" *"),
                          })),
                      title: session.title,
                      track: session.track ?? undefined,
                      youtube: session.youtube,
                      recordingUrl: session.recordingUrl,
                    };
                  }),
                ),
                time: slot.time,
                title: slot.title ?? undefined,
              };
            }),
          ),
        };
      }),
  );
  return await render(
    <ContentAgenda
      days={days}
      speakers={speakers}
      timeZone={timeZone}
      legacySpeakerFragments={legacySpeakerFragments}
      fragmentNavigation
    />,
  );
}
