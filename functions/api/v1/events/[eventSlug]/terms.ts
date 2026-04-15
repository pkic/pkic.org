import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import { getEventBySlug, getRequiredTerms } from "../../../../_lib/services/events";
import { json } from "../../../../_lib/http";

export async function onRequestGet(c: any): Promise<Response> {
  const audience = (new URL(c.req.raw.url).searchParams.get("audience") ?? "attendee") as "attendee" | "speaker";
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const terms = await getRequiredTerms(c.env.DB, event.id, audience);

  return json({
    event: { id: event.id, slug: event.slug, name: event.name },
    audience,
    terms: terms.map((term: any) => ({
      termKey: term.term_key,
      version: term.version,
      required: term.required === 1,
      contentRef: term.content_ref,
      displayText: term.display_text,
      helpText: term.help_text ?? null,
    })),
  });
}

export class TermsGet extends OpenAPIRoute {
  schema = {
    summary: "Get event terms",
    description: "Returns the required terms and conditions for a given event.",
    tags: ["Events"],
    request: {
      params: z.object({
        eventSlug: z.string(),
      }),
      query: z.object({
        audience: z.enum(["attendee", "speaker"]).optional().default("attendee"),
      }),
    },
    responses: {
      "200": {
        description: "Returns the terms.",
        content: {
          "application/json": {
            schema: z.object({
              event: z.object({
                id: z.string(),
                slug: z.string(),
                name: z.string(),
              }),
              audience: z.enum(["attendee", "speaker"]),
              terms: z.array(
                z.object({
                  termKey: z.string(),
                  version: z.string(),
                  required: z.boolean(),
                  contentRef: z.string(),
                  displayText: z.string(),
                  helpText: z.string().nullable(),
                }),
              ),
            }),
          },
        },
      },
    },
  };

  async handle(c: any) {
    const data = await this.getValidatedData<typeof this.schema>();
    const audience = data.query.audience;
    const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
    const terms = await getRequiredTerms(c.env.DB, event.id, audience);

    return c.json({
      event: { id: event.id, slug: event.slug, name: event.name },
      audience,
      terms: terms.map((term: any) => ({
        termKey: term.term_key,
        version: term.version,
        required: term.required === 1,
        contentRef: term.content_ref,
        displayText: term.display_text,
        helpText: term.help_text ?? null,
      })),
    });
  }
}
