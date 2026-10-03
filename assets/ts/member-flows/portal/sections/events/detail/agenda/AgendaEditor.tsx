import { lazy, Suspense } from "preact/compat";
import { useState } from "preact/hooks";
import {
  agendaAdmissionPolicySchema,
  agendaSwapSchema,
  agendaOccurrencePatchSchema,
  agendaSnapshotSchema,
  agendaOccurrenceListSchema,
  agendaRevisionSchema,
  type AgendaOccurrence,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { instantToDateTimeLocal } from "../../../../../../../shared/timezone";
import { formatCalendarDate, formatTimeRangeInZone } from "../../../../../../../shared/format-date";
import { useData } from "../../../../../../hooks/useData";
import { getJson, patchJson, postJson } from "../../../../../../shared/api-client";
import { ContentAgenda } from "../../../../../../site/ContentAgenda";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { RowActions } from "../../../../../../ui/RowActions";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import { agendaPresenter } from "./presenter";
import { AgendaGeometry } from "./AgendaGeometry";
import { AgendaSettings } from "./AgendaSettings";
import { SessionMove } from "./SessionMove";
import { AgendaImport } from "./AgendaImport";
import { SessionSwap } from "./SessionSwap";
import { RoomEditor } from "./RoomEditor";
import { SessionEditor } from "./SessionEditor";
import { StaffingEditor } from "./StaffingEditor";
import "./AgendaEditor.css";

const SessionBookings = lazy(() =>
  import("../participation/SessionBookings").then((module) => ({ default: module.SessionBookings })),
);

export function AgendaEditor({ slug, canEdit }: { slug: string; canEdit: boolean }) {
  const source = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda`, agendaSnapshotSchema),
    [slug],
  );
  const [participation, setParticipation] = useState<AgendaOccurrence | null>(null);
  const [settings, setSettings] = useState(false);
  const [moving, setMoving] = useState<AgendaOccurrence | null>(null);
  const [undo, setUndo] = useState<
    | { id: string; body: ReturnType<typeof agendaOccurrencePatchSchema.parse> }
    | { swap: true; body: ReturnType<typeof agendaSwapSchema.parse> }
    | null
  >(null);
  const [importing, setImporting] = useState(false);
  const [swapping, setSwapping] = useState<AgendaOccurrence | null>(null);
  const [addingRoom, setAddingRoom] = useState(false);
  const [snapshot, setSnapshot] = useState<AgendaSnapshot | null>(null);
  const [view, setView] = useState("agenda");
  const [day, setDay] = useState("");
  const [editing, setEditing] = useState<AgendaOccurrence | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resizing, setResizing] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const data = snapshot?.eventSlug === slug ? snapshot : source.data;
  if (source.loading && !data) return <Spinner label="Loading agenda…" />;
  if (!data) return <ErrorAlert error={source.error ?? "Agenda unavailable"} />;
  const days = agendaPresenter(data);
  const activeDay = days.find((value) => value.date === day) ?? days[0];
  const base = `/api/v1/events/${encodeURIComponent(slug)}/agenda`;
  function accept(next: AgendaSnapshot) {
    const changed = data!.occurrences.filter((previous) => {
      const current = next.occurrences.find((value) => value.id === previous.id);
      return current && JSON.stringify(current) !== JSON.stringify(previous);
    });
    if (changed.length === 1 && next.occurrences.length === data!.occurrences.length) {
      const previous = changed[0];
      setUndo({
        id: previous.id,
        body: agendaOccurrencePatchSchema.parse({
          expectedRevision: next.revision,
          title: previous.title,
          description: previous.description,
          startAt: previous.startAt,
          endAt: previous.endAt,
          roomId: previous.roomId,
          admissionPolicy: previous.admissionPolicy,
          capacity: previous.capacity,
          remoteCapacity: previous.remoteCapacity,
          presentationUrl: previous.presentationUrl,
          recordingUrl: previous.recordingUrl,
          visibility: previous.visibility,
          kind: previous.kind,
          speakerUserIds: previous.speakers.map((speaker) => speaker.userId),
        }),
      });
    } else if (
      changed.length === 2 &&
      next.occurrences.length === data!.occurrences.length &&
      next.occurrences.find((value) => value.id === changed[0].id)?.startAt === changed[1].startAt &&
      next.occurrences.find((value) => value.id === changed[1].id)?.startAt === changed[0].startAt
    ) {
      setUndo({
        swap: true,
        body: agendaSwapSchema.parse({
          expectedRevision: next.revision,
          firstId: changed[0].id,
          secondId: changed[1].id,
        }),
      });
    } else setUndo(null);
    setSnapshot(next);
  }
  async function undoLastEdit() {
    if (!undo) return;
    setBusy(true);
    setError("");
    try {
      setSnapshot(
        "id" in undo
          ? await patchJson(`${base}/occurrences/${encodeURIComponent(undo.id)}`, undo.body, agendaSnapshotSchema)
          : await postJson(`${base}/swaps`, undo.body, agendaSnapshotSchema),
      );
      setUndo(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to undo this edit");
      setSnapshot(null);
      setUndo(null);
      await source.reload();
    } finally {
      setBusy(false);
    }
  }
  async function mutate(action: () => Promise<AgendaSnapshot>) {
    setBusy(true);
    setError("");
    try {
      accept(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update agenda");
    } finally {
      setBusy(false);
    }
  }
  function move(id: string, startAt: string, roomId: string) {
    const occurrence = data!.occurrences.find((value) => value.id === id);
    if (!occurrence) return;
    const duration =
      occurrence.startAt && occurrence.endAt ? Date.parse(occurrence.endAt) - Date.parse(occurrence.startAt) : 1800000;
    void mutate(() =>
      patchJson(
        `${base}/occurrences/${encodeURIComponent(id)}`,
        {
          expectedRevision: data!.revision,
          startAt,
          endAt: new Date(Date.parse(startAt) + duration).toISOString(),
          roomId,
        },
        agendaSnapshotSchema,
      ),
    );
  }
  function resize(id: string, endAt: string, roomId: string) {
    const occurrence = data!.occurrences.find((value) => value.id === id);
    if (!occurrence) return;
    if (occurrence.roomId !== roomId) {
      setError("Choose an end time in the session's current location.");
      return;
    }
    void mutate(() =>
      patchJson(
        `${base}/occurrences/${encodeURIComponent(id)}`,
        { expectedRevision: data!.revision, endAt },
        agendaSnapshotSchema,
      ),
    );
    setResizing(null);
  }
  function actions(occurrence: AgendaOccurrence) {
    return [
      { id: "participation", label: "Participation / approvals", onSelect: () => setParticipation(occurrence) },
      {
        id: "resize",
        label: "Select end time to resize",
        disabled: !occurrence.startAt || busy,
        onSelect: () => {
          setResizing(occurrence.id);
          setDragged(null);
        },
      },
      { id: "move", label: "Move to day / location", disabled: busy, onSelect: () => setMoving(occurrence) },
      { id: "select", label: "Select for move", disabled: busy, onSelect: () => setDragged(occurrence.id) },
      {
        id: "swap",
        label: "Swap sessions",
        disabled: !occurrence.startAt || busy,
        onSelect: () => setSwapping(occurrence),
      },
      {
        id: "extend",
        label: "Extend by 15 minutes",
        disabled: !occurrence.endAt || busy,
        onSelect: () => {
          if (occurrence.endAt)
            void mutate(() =>
              patchJson(
                `${base}/occurrences/${encodeURIComponent(occurrence.id)}`,
                {
                  expectedRevision: data!.revision,
                  endAt: new Date(Date.parse(occurrence.endAt!) + 900000).toISOString(),
                },
                agendaSnapshotSchema,
              ),
            );
        },
      },
      { id: "edit", label: "Edit / move session", onSelect: () => setEditing(occurrence) },
      {
        id: "earlier",
        label: "Move earlier · 15 minutes",
        disabled: !occurrence.startAt || busy,
        onSelect: () =>
          occurrence.startAt &&
          occurrence.roomId &&
          move(occurrence.id, new Date(Date.parse(occurrence.startAt) - 900000).toISOString(), occurrence.roomId),
      },
      {
        id: "later",
        label: "Move later · 15 minutes",
        disabled: !occurrence.startAt || busy,
        onSelect: () =>
          occurrence.startAt &&
          occurrence.roomId &&
          move(occurrence.id, new Date(Date.parse(occurrence.startAt) + 900000).toISOString(), occurrence.roomId),
      },
    ];
  }
  return (
    <div class="pk-stack pk-agenda-editor">
      <Panel>
        <PanelHeader title="Agenda">
          <div class="pk-agenda-editor__views">
            {["agenda", "sessions", "staffing"].map((value) => (
              <Button aria-pressed={view === value} onClick={() => setView(value)}>
                {value === "agenda" ? "Agenda" : value === "sessions" ? "All sessions" : "Block roles"}
              </Button>
            ))}
          </div>
        </PanelHeader>
        <PanelBody>
          <div class="pk-agenda-editor__toolbar">
            <div>
              <strong>Draft revision {data.revision}</strong>
              <p class="pk-agenda-editor__notice">
                {data.publishedRevision === data.revision
                  ? "This revision is approved. The public website updates after a successful site build."
                  : `Approved revision ${data.publishedRevision ?? "none"}. Changes stay in the portal until approved for a site build.`}{" "}
                · {data.timeZone}
              </p>
            </div>
            {canEdit && (
              <div class="pk-cluster">
                {undo && (
                  <Button disabled={busy} onClick={() => void undoLastEdit()}>
                    Undo last session edit
                  </Button>
                )}
                <Button onClick={() => setSettings(true)}>Scheduling rules</Button>
                <Button onClick={() => setImporting(true)}>Import sessions</Button>
                <Button onClick={() => setAddingRoom(true)}>New location</Button>
                <Button onClick={() => setEditing(null)}>New session</Button>
                <Button
                  variant="primary"
                  disabled={busy || data.revision === data.publishedRevision}
                  onClick={() =>
                    void mutate(() =>
                      postJson(
                        `${base}/publications`,
                        agendaRevisionSchema.parse({ expectedRevision: data.revision }),
                        agendaSnapshotSchema,
                      ),
                    )
                  }
                >
                  Approve for publication
                </Button>
              </div>
            )}
          </div>
        </PanelBody>
      </Panel>
      {(error || source.error) && <ErrorAlert error={error || source.error!} />}
      {participation && canEdit && (
        <Panel>
          <PanelHeader title={`Participation · ${participation.title}`}>
            <Button onClick={() => setParticipation(null)}>Close</Button>
          </PanelHeader>
          <PanelBody>
            <Suspense fallback={<Spinner />}>
              <SessionBookings slug={slug} occurrenceId={participation.id} />
            </Suspense>
          </PanelBody>
        </Panel>
      )}
      {settings && canEdit && <AgendaSettings snapshot={data} onSaved={accept} onClose={() => setSettings(false)} />}
      {moving && canEdit && (
        <SessionMove snapshot={data} session={moving} onSaved={accept} onClose={() => setMoving(null)} />
      )}
      {importing && canEdit && <AgendaImport snapshot={data} onSaved={accept} onClose={() => setImporting(false)} />}
      {swapping && canEdit && (
        <SessionSwap snapshot={data} first={swapping} onSaved={accept} onClose={() => setSwapping(null)} />
      )}
      {addingRoom && canEdit && <RoomEditor snapshot={data} onSaved={accept} onClose={() => setAddingRoom(false)} />}
      {editing !== undefined && canEdit && (
        <SessionEditor
          key={editing?.id ?? "new"}
          snapshot={data}
          occurrence={editing ?? undefined}
          onSaved={accept}
          onClose={() => setEditing(undefined)}
        />
      )}
      {view === "agenda" && (
        <>
          <div class="pk-cluster" role="group" aria-label="Agenda days">
            {days.map((value) => (
              <Button aria-pressed={activeDay?.date === value.date} onClick={() => setDay(value.date)}>
                {formatCalendarDate(value.date)}
              </Button>
            ))}
          </div>
          {activeDay && <AgendaGeometry day={activeDay} />}
          {activeDay ? (
            <ContentAgenda
              days={[activeDay]}
              speakers={[]}
              timeZone={data.timeZone}
              editor={{
                session: (id) => {
                  const occurrence = data.occurrences.find((value) => value.id === id)!;
                  return {
                    resizeHandle: canEdit ? (
                      <button
                        class="pk-agenda-editor__resize"
                        type="button"
                        draggable
                        aria-label={`Resize ${occurrence.title} by dragging to an end time`}
                        onDragStart={(event) => {
                          event.stopPropagation();
                          event.dataTransfer?.setData("application/x-pkic-agenda-resize", id);
                          setResizing(id);
                          setDragged(null);
                        }}
                        onClick={() => {
                          setResizing(id);
                          setDragged(null);
                        }}
                      >
                        ↕ Resize duration
                      </button>
                    ) : null,
                    controls: canEdit ? (
                      <div class="pk-agenda-editor__card-actions">
                        <RowActions subject={occurrence.title} actions={actions(occurrence)} />
                      </div>
                    ) : null,
                    onOpen: undefined,
                    onDragStart: canEdit
                      ? (event) => {
                          event.dataTransfer?.setData("text/plain", id);
                          setDragged(id);
                          setResizing(null);
                        }
                      : undefined,
                  };
                },
                dropTarget: (startAt, roomId) =>
                  canEdit ? (
                    <button
                      type="button"
                      class="pk-agenda-editor__drop"
                      disabled={busy}
                      aria-label={`${resizing ? "End selected session" : "Move selected session"} at ${formatTimeRangeInZone(startAt, undefined, data.timeZone)} in ${data.rooms.find((room) => room.id === roomId)?.name}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const resizeId = event.dataTransfer?.getData("application/x-pkic-agenda-resize");
                        if (resizeId) {
                          resize(resizeId, startAt, roomId);
                          return;
                        }
                        const id = event.dataTransfer?.getData("text/plain") || dragged;
                        if (id) move(id, startAt, roomId);
                        setDragged(null);
                      }}
                      onClick={() => {
                        if (resizing) {
                          resize(resizing, startAt, roomId);
                          return;
                        }
                        if (dragged) {
                          move(dragged, startAt, roomId);
                          setDragged(null);
                        }
                      }}
                    >
                      {resizing ? "End selected session here" : dragged ? "Move selected session here" : "Drop here"} ·{" "}
                      {formatTimeRangeInZone(startAt, undefined, data.timeZone)}
                    </button>
                  ) : null,
              }}
            />
          ) : (
            <Panel>
              <PanelBody>
                <p>No scheduled sessions yet. Create a session or schedule one from the backlog.</p>
              </PanelBody>
            </Panel>
          )}
          <Panel>
            <PanelHeader title="Unscheduled sessions" />
            <PanelBody>
              <div class="pk-agenda-editor__backlog">
                {data.occurrences
                  .filter((value) => !value.startAt || !value.roomId)
                  .map((value) => (
                    <article
                      draggable={canEdit}
                      onDragStart={(event) => {
                        event.dataTransfer?.setData("text/plain", value.id);
                        setDragged(value.id);
                      }}
                    >
                      <strong>{value.title}</strong>
                      {canEdit && <RowActions subject={value.title} actions={actions(value)} />}
                    </article>
                  ))}
              </div>
            </PanelBody>
          </Panel>
        </>
      )}
      {view === "sessions" && (
        <ApiDataTable
          key={data.revision}
          endpoint={`${base}/occurrences`}
          responseSchema={agendaOccurrenceListSchema}
          resolve={(response) => response.occurrences}
          resolvePage={(response) => response.page}
          paginate
          urlState="agenda"
          caption="Sessions across all days"
          rowKey={(row) => row.id}
          rowAction={canEdit ? (row) => ({ label: `Edit ${row.title}`, onSelect: () => setEditing(row) }) : undefined}
          searchPlaceholder="Search sessions…"
          initialSort="startAt"
          columns={[
            { header: "Session", cell: (row) => row.title, sort: { asc: "title", desc: "-title" }, hideable: false },
            {
              header: "Day",
              cell: (row) =>
                row.startAt
                  ? formatCalendarDate(instantToDateTimeLocal(row.startAt, data.timeZone).slice(0, 10))
                  : "Unscheduled",
              filter: {
                param: "day",
                options: [
                  { value: "", label: "All days" },
                  ...days.map((day) => ({ value: day.date, label: formatCalendarDate(day.date) })),
                ],
              },
            },
            {
              header: "Time",
              cell: (row) =>
                row.startAt ? formatTimeRangeInZone(row.startAt, row.endAt ?? undefined, data.timeZone) : "Unscheduled",
              sort: { asc: "startAt", desc: "-startAt" },
            },
            {
              header: "Location",
              cell: (row) => data.rooms.find((room) => room.id === row.roomId)?.name ?? "Unassigned",
              filter: {
                param: "roomId",
                options: [
                  { value: "", label: "All locations" },
                  ...data.rooms.map((room) => ({ value: room.id, label: room.name })),
                ],
              },
            },
            {
              header: "Admission",
              cell: (row) => row.admissionPolicy,
              filter: {
                param: "admissionPolicy",
                options: [
                  { value: "", label: "All policies" },
                  ...agendaAdmissionPolicySchema.options.map((value) => ({ value, label: value })),
                ],
              },
            },
            {
              header: "Actions",
              cell: (row) => (canEdit ? <RowActions subject={row.title} actions={actions(row)} /> : null),
              hideable: false,
            },
          ]}
        />
      )}
      {view === "staffing" && <StaffingEditor snapshot={data} canEdit={canEdit} onSaved={accept} />}
    </div>
  );
}
