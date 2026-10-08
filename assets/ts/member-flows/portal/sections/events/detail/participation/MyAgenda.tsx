import { useHashLocation } from "wouter/use-hash-location";
import { useState } from "preact/hooks";
import type { z } from "zod";
import { databaseIdSchema } from "../../../../../../../shared/schemas/identifiers";
import { agendaTimeZones, formatAgendaWindow } from "../../../../../../../shared/agenda-time-display";
import {
  personalAgendaResponseSchema,
  personalAgendaSessionSchema,
} from "../../../../../../../shared/schemas/event-personal-agenda";
import { PersonalAgendaStatus } from "./PersonalAgendaStatus";
import { CalendarSubscription } from "./CalendarSubscription";
import { SessionParticipation } from "./SessionParticipation";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { ButtonLink } from "../../../../../../ui/Button";
import { Menu } from "../../../../../../ui/Menu";
import { usePortalHashLocation } from "../../../../hash-location";

type Session = z.infer<typeof personalAgendaSessionSchema>;
export function MyAgenda({ slug }: { slug: string }) {
  const [showLocalTime, setShowLocalTime] = useState(false);
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [rawLocation] = useHashLocation();
  const path = rawLocation.split("?", 1)[0];
  const query = new URLSearchParams(rawLocation.split("?", 2)[1] ?? "");
  const focus = databaseIdSchema.safeParse(query.get("session"));
  const destination = (values: { session?: string; view?: string }) => {
    const next = new URLSearchParams(query);
    next.delete("session");
    next.delete("view");
    if (values.session) next.set("session", values.session);
    if (values.view) next.set("view", values.view);
    return path + (next.size ? `?${next}` : "");
  };
  const backHref = usePortalHashLocation.hrefs(destination({}));
  if (query.get("view") === "calendar")
    return (
      <div class="pk-stack">
        <PageHeader title="Calendar preferences" actions={<ButtonLink href={backHref}>Back to My agenda</ButtonLink>} />
        <CalendarSubscription slug={slug} />
      </div>
    );
  if (focus.success)
    return (
      <SessionParticipation
        key={focus.data}
        slug={slug}
        occurrenceId={focus.data}
        backHref={backHref}
        showLocalTime={showLocalTime}
      />
    );
  return (
    <div class="pk-stack">
      <PageHeader
        title="My agenda"
        actions={
          <Menu
            label="My agenda actions"
            align="end"
            items={[
              {
                id: "calendar",
                label: "Calendar preferences",
                href: usePortalHashLocation.hrefs(destination({ view: "calendar" })),
              },
            ]}
          />
        }
      />
      <Checkbox
        label="Also show my local time"
        checked={showLocalTime}
        onInput={(event) => setShowLocalTime(event.currentTarget.checked)}
      />
      <p>Saving a preference does not guarantee admission. Reserve a place where registration is required.</p>
      <ApiDataTable<Session, z.infer<typeof personalAgendaResponseSchema>>
        endpoint={`/api/v1/events/${encodeURIComponent(slug)}/agenda/participation`}
        caption="My event agenda"
        responseSchema={personalAgendaResponseSchema}
        resolve={(value) => value.sessions}
        resolvePage={(value) => value.page}
        paginate
        initialSort="startAt"
        rowKey={(row) => row.id}
        searchPlaceholder="Find a session…"
        empty="No sessions match your search."
        columns={[
          {
            header: "Session",
            sort: { asc: "title", desc: "-title" },
            cell: (row) => <a href={usePortalHashLocation.hrefs(destination({ session: row.id }))}>{row.title}</a>,
          },
          {
            header: "When",
            sort: { asc: "startAt", desc: "-startAt" },
            cell: (row) => {
              const zones = agendaTimeZones(row.timeZone, localZone, row.attendanceMode, showLocalTime);
              return (
                <>
                  <span>
                    {zones.primary.label} · {formatAgendaWindow(row.startAt, row.endAt, zones.primary.zone)}
                  </span>
                  {zones.secondary && (
                    <small class="pk-muted">
                      {zones.secondary.label} · {formatAgendaWindow(row.startAt, row.endAt, zones.secondary.zone)}
                    </small>
                  )}
                </>
              );
            },
          },
          { header: "My agenda", cell: (row) => <PersonalAgendaStatus session={row} /> },
          {
            header: "",
            width: "fit",
            cell: (row) => (
              <Menu
                label={`Actions for ${row.title}`}
                align="end"
                items={[
                  {
                    id: "manage",
                    label: "Manage participation",
                    href: usePortalHashLocation.hrefs(destination({ session: row.id })),
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
