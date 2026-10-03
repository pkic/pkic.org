import { normalizeLinks } from "../../../assets/shared/schemas/links";
import { render } from "preact-render-to-string";
import { ContentAgenda } from "../../../assets/ts/site/ContentAgenda";
import type { ContentComponentContext } from "./site-components";
import { conferenceLocation } from "./site-conference-location";
import { publishedConferenceProgram } from "./site-conference-program";

export async function renderContentAgenda(
  context: ContentComponentContext,
  markdownHtml: (value: unknown) => Promise<string>,
): Promise<string> {
  if (!context.eventData?.agenda) return "";
  const eventAssets = context.eventAssetUrls ?? context.assetUrls;
  const program = publishedConferenceProgram(context.eventData, eventAssets);
  const rawAgenda = program.agenda;
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
          locations: roomIds.map((id) => ({ id, label: conferenceLocation(program, date, id).name })),
          slots: await Promise.all(
            slots.map(async (slot) => {
              return {
                startsAt: slot.startsAt,
                durationMinutes: slot.durationMinutes,
                sessions: await Promise.all(
                  slot.sessions.map(async (session) => {
                    return {
                      descriptionHtml: await markdownHtml(session.description),
                      durationMinutes: session.durationMinutes,
                      endsAt: session.endsAt,
                      locations: session.locations,
                      presentationUrl:
                        typeof session.presentation === "string" ? eventAssets(session.presentation)[0] : undefined,
                      speakers: session.speakers.map((name) => ({
                        ...(speakerByName.get(name.replace(/ \*$/, "")) ?? { name: name.replace(/ \*$/, "") }),
                        moderator: name.endsWith(" *"),
                      })),
                      title: session.title,
                      track: session.track ?? undefined,
                      youtube: session.youtube,
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
  return render(<ContentAgenda days={days} speakers={speakers} timeZone={timeZone} />);
}
