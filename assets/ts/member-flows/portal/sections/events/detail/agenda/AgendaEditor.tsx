import { AgendaSourcesControl } from "./AgendaSourcesControl";
import { useAgendaSessionLocations } from "./useAgendaSessionLocations";
import { splitHash } from "../../../../../../shared/hash-query";
import { AgendaPointerPlacement } from "./AgendaPointerPlacement";
import { useAgendaRoomEditor } from "./useAgendaRoomEditor";
import { useAgendaInteractionLock } from "./useAgendaInteractionLock";
import { agendaSessionInteractions } from "./AgendaSessionInteractions";
import { AgendaWindowSelection, type AgendaSessionWindow } from "./AgendaWindowSelection";
import { AgendaWorkspaceActions } from "./AgendaWorkspaceActions";
import { AgendaPublicationWorkspace } from "./AgendaPublicationWorkspace";
import { AgendaRoomQuickEdit } from "./AgendaRoomQuickEdit";
import { AgendaSelectionStatus } from "./AgendaSelectionStatus";
import { AgendaPlanningSources } from "./AgendaPlanningSources";
import { useAcceptedProposalPlacement } from "./useAcceptedProposalPlacement";
import { AgendaBoardDropTarget } from "./AgendaBoardDropTarget";
import { AgendaPublicPreview } from "./AgendaPublicPreview";
import { AgendaWorkspaceHeader, AgendaWorkspacePanels, type AgendaWorkspaceView } from "./AgendaWorkspaceHeader";
import { SessionDuplicate } from "./SessionDuplicate";
import { agendaMovedSpeakers } from "../../../../../../../shared/event-agenda-rooms";
import {
  agendaScheduleProposalSchema,
  type AgendaScheduleProposal,
} from "../../../../../../../shared/schemas/event-agenda-schedule";
import { useAgendaScheduling } from "./useAgendaScheduling";
import { agendaSessionActions } from "./session-actions";
import { useAgendaTargetSelection } from "./useAgendaTargetSelection";
import { ContentLibrary, StaffingEditor, AgendaImport } from "./AgendaOptionalPanels";
import { AgendaCreationDialogs } from "./AgendaCreationDialogs";
import { AgendaSessionTable } from "./AgendaSessionTable";
import { SessionPromotionKit } from "./SessionPromotionKit";
import { SessionHistoryEditor } from "./SessionHistoryEditor";
import { lazy, Suspense } from "preact/compat";
import { useState } from "preact/hooks";
import {
  agendaOccurrencePatchSchema,
  agendaOccurrenceSchema,
  agendaSnapshotSchema,
  type AgendaOccurrence,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { AgendaDayNavigation } from "./AgendaDayNavigation";
import { useData } from "../../../../../../hooks/useData";
import { useUrlTableState } from "../../../../../../hooks/useUrlTableState";
import { getJson, patchJson } from "../../../../../../shared/api-client";
import { ContentAgenda } from "../../../../../../site/ContentAgenda";
import { Button } from "../../../../../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { agendaPresenter } from "./presenter";
import { AgendaGeometry } from "./AgendaGeometry";
import { AgendaSettings } from "./AgendaSettings";
import { SessionMove } from "./SessionMove";
import { SessionSwap } from "./SessionSwap";
import { RoomEditor } from "./RoomEditor";
import "./AgendaEditor.css";

const Locations = lazy(() => import("./AgendaLocations").then((module) => ({ default: module.AgendaLocations })));

const SessionBookings = lazy(() =>
  import("../participation/SessionBookings").then((module) => ({ default: module.SessionBookings })),
);

export function AgendaEditor({
  slug,
  canEdit,
  canReviewAppearances = false,
  teamEligibilityPath,
}: {
  slug: string;
  canEdit: boolean;
  canReviewAppearances?: boolean;
  teamEligibilityPath?: string;
}) {
  const source = useData(
    () => getJson(`/api/v1/events/${encodeURIComponent(slug)}/agenda`, agendaSnapshotSchema),
    [slug],
  );
  const [promotionSession, setPromotionSession] = useState<AgendaOccurrence | null>(null);
  const [historySession, setHistorySession] = useState<AgendaOccurrence | null>(null);
  const [participation, setParticipation] = useState<AgendaOccurrence | null>(null);
  const [settings, setSettings] = useState(false);
  const [moving, setMoving] = useState<AgendaOccurrence | null>(null);
  const [undo, setUndo] = useState<
    | { id: string; body: ReturnType<typeof agendaOccurrencePatchSchema.parse> }
    | { schedule: true; body: AgendaScheduleProposal }
    | null
  >(null);
  const [importing, setImporting] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [publicPreview, setPublicPreview] = useState(false);
  const [publicationReview, setPublicationReview] = useState(false);
  const [addingBreak, setAddingBreak] = useState(false);
  const [importProposalIds, setImportProposalIds] = useState<string[] | undefined>();
  const [duplicating, setDuplicating] = useState<AgendaOccurrence | null>(null);
  const [swapping, setSwapping] = useState<AgendaOccurrence | null>(null);
  const roomEditor = useAgendaRoomEditor();
  const [snapshot, setSnapshot] = useState<AgendaSnapshot | null>(null);
  const [view, setView] = useState<AgendaWorkspaceView>(() =>
    splitHash().params.get("view") === "staffing" ? "staffing" : "agenda",
  );
  const [day, setDay] = useState("");
  const [newWindow, setNewWindow] = useState<AgendaSessionWindow | undefined>();
  const [editing, setEditing] = useState<AgendaOccurrence | null | undefined>(undefined);
  function createSession(window?: AgendaSessionWindow) {
    setNewWindow(window);
    setEditing(null);
  }
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const data = snapshot?.eventSlug === slug ? snapshot : source.data;
  const interactionLock = useAgendaInteractionLock(slug);
  const acceptedPlacement = useAcceptedProposalPlacement(slug, {
    snapshot: data,
    onSaved: accept,
    canEdit: canEdit && !interactionLock.locked,
  });
  const target = useAgendaTargetSelection(slug, busy, data?.occurrences, interactionLock.locked || !canEdit);
  const { resizing, dragged } = target;
  const scheduling = useAgendaScheduling(slug, data, busy, accept, target.cancel, setError);
  const roomSelection = useAgendaSessionLocations(data, scheduling);
  useUrlTableState("agenda");
  if (source.loading && !data) return <Spinner label="Loading agenda…" />;
  if (!data) return <ErrorAlert error={source.error ?? "Agenda unavailable"} />;
  const days = agendaPresenter(data, scheduling.timeStep);
  const activeDay = days.find((value) => value.date === day) ?? days[0];
  const base = `/api/v1/events/${encodeURIComponent(slug)}/agenda`;
  function accept(next: AgendaSnapshot) {
    const changed = data!.occurrences.filter((previous) => {
      const current = next.occurrences.find((value) => value.id === previous.id);
      return current && JSON.stringify(current) !== JSON.stringify(previous);
    });
    const schedulingOnly =
      changed.length > 0 &&
      changed.every((previous) => {
        const current = next.occurrences.find((item) => item.id === previous.id)!;
        const stable = (item: AgendaOccurrence) =>
          agendaOccurrenceSchema.parse({
            ...item,
            startAt: null,
            endAt: null,
            roomId: null,
            additionalRoomIds: [],
            publicationStatus: undefined,
          });
        return (
          JSON.stringify(stable({ ...previous, speakers: agendaMovedSpeakers(previous, current.roomId) })) ===
            JSON.stringify(stable(current)) &&
          (previous.startAt !== current.startAt ||
            previous.endAt !== current.endAt ||
            previous.roomId !== current.roomId ||
            JSON.stringify(previous.additionalRoomIds) !== JSON.stringify(current.additionalRoomIds))
        );
      });
    if (schedulingOnly && next.occurrences.length === data!.occurrences.length) {
      setUndo({
        schedule: true,
        body: agendaScheduleProposalSchema.parse({
          expectedRevision: next.revision,
          changes: changed.map((previous) => ({
            id: previous.id,
            startAt: previous.startAt,
            endAt: previous.endAt,
            roomId: previous.roomId,
            additionalRoomIds: previous.additionalRoomIds ?? [],
            speakerPlacements: Object.fromEntries(
              previous.speakers.map((speaker) => [
                speaker.userId,
                { attendanceMode: speaker.attendanceMode ?? "physical", roomId: speaker.roomId ?? null },
              ]),
            ),
          })),
        }),
      });
    } else if (changed.length === 1 && next.occurrences.length === data!.occurrences.length) {
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
          additionalRoomIds: previous.additionalRoomIds ?? [],
          requiredEquipment: previous.requiredEquipment ?? [],
          accessPolicy: previous.accessPolicy,
          bookingOpensAt: previous.bookingOpensAt,
          bookingClosesAt: previous.bookingClosesAt,
          admissionPolicy: previous.admissionPolicy,
          capacity: previous.capacity,
          remoteCapacity: previous.remoteCapacity,
          presentationUrl: previous.presentationUrl,
          recordingUrl: previous.recordingUrl,
          visibility: previous.visibility,
          kind: previous.kind,
          speakerUserIds: previous.speakers.map((speaker) => speaker.userId),
          speakerRoles: Object.fromEntries(
            previous.speakers.map((speaker) => [speaker.userId, speaker.role ?? "speaker"]),
          ),
          speakerPlacements: Object.fromEntries(
            previous.speakers.map((speaker) => [
              speaker.userId,
              { attendanceMode: speaker.attendanceMode ?? "physical", roomId: speaker.roomId ?? null },
            ]),
          ),
        }),
      });
    } else setUndo(null);
    setSnapshot(next);
  }
  async function undoLastEdit() {
    if (!undo) return;
    if ("schedule" in undo) {
      void scheduling.apply(undo.body);
      setUndo(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      setSnapshot(
        await patchJson(`${base}/occurrences/${encodeURIComponent(undo.id)}`, undo.body, agendaSnapshotSchema),
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
  const { move, resize } = scheduling;
  function invalidResizeTarget(startAt: string, roomId: string) {
    const occurrence = data!.occurrences.find((value) => value.id === resizing);
    return (
      !!resizing &&
      (!occurrence?.startAt ||
        occurrence.roomId !== (roomId || null) ||
        Date.parse(startAt) <= Date.parse(occurrence.startAt))
    );
  }
  function actions(occurrence: AgendaOccurrence, beforeSelect?: () => void) {
    return agendaSessionActions(
      occurrence,
      {
        canEdit,
        canReviewAppearances,
        busy,
        scheduling,
        open: {
          duplicate: setDuplicating,
          history: setHistorySession,
          promotion: setPromotionSession,
          participation: setParticipation,
          move: setMoving,
          swap: setSwapping,
          edit: setEditing,
          locations: roomSelection.open,
        },
        select: (id, kind) => {
          setView("agenda");
          target.select(id, kind);
        },
      },
      beforeSelect,
    );
  }
  const workspaceActions = (
    <AgendaWorkspaceActions
      snapshot={data}
      canEdit={canEdit}
      busy={busy}
      onUndo={undo ? () => void undoLastEdit() : undefined}
      calendarLocked={interactionLock.locked}
      onToggleCalendarLock={interactionLock.toggle}
      onNewSession={() => createSession()}
      onNewBreak={() => setAddingBreak(true)}
      onSettings={() => setSettings(true)}
      onReuseSession={() => setView("library")}
      onImport={() => {
        setImportProposalIds(undefined);
        setImporting(true);
      }}
      onPreview={() => setPublicPreview(true)}
      onNewLocation={roomEditor.create}
      onEditLocation={roomEditor.edit}
      onPublication={() => setPublicationReview(true)}
    />
  );
  if (canEdit && scheduling.panel) return scheduling.panel;
  if (
    (canEdit && (participation || importing || roomEditor.open)) ||
    promotionSession ||
    (historySession && (canEdit || canReviewAppearances))
  )
    return (
      <div class="pk-stack pk-agenda-editor">
        {participation && canEdit && (
          <Panel>
            <PanelHeader title={`Participation · ${participation.title}`}>
              <Button onClick={() => setParticipation(null)}>Close</Button>
            </PanelHeader>
            <PanelBody>
              <Suspense fallback={<Spinner />}>
                <SessionBookings
                  slug={slug}
                  occurrenceId={participation.id}
                  onReviewRoom={(proposal) => {
                    const current = data.occurrences.find((item) => item.id === participation.id);
                    if (current)
                      setEditing({
                        ...current,
                        roomId: proposal.proposedRoomId,
                        additionalRoomIds: proposal.proposedAdditionalRoomIds,
                        capacity: proposal.proposedCapacity,
                      });
                  }}
                />
              </Suspense>
            </PanelBody>
          </Panel>
        )}

        {importing && canEdit && (
          <AgendaImport
            snapshot={data}
            initialProposalIds={importProposalIds}
            onSaved={accept}
            onClose={() => setImporting(false)}
          />
        )}

        {roomEditor.open && canEdit && (
          <RoomEditor
            key={roomEditor.room?.id ?? "new"}
            snapshot={data}
            room={roomEditor.room}
            onSaved={accept}
            onClose={roomEditor.close}
          />
        )}
        {promotionSession && (
          <SessionPromotionKit
            slug={slug}
            occurrence={promotionSession}
            snapshot={canEdit ? data : undefined}
            onSaved={setSnapshot}
            onClose={() => setPromotionSession(null)}
          />
        )}
        {historySession && (canEdit || canReviewAppearances) && (
          <SessionHistoryEditor
            canEdit={canEdit}
            snapshot={data}
            occurrence={historySession}
            onSaved={setSnapshot}
            onClose={() => setHistorySession(null)}
          />
        )}
      </div>
    );
  if (publicPreview) return <AgendaPublicPreview slug={slug} onClose={() => setPublicPreview(false)} />;
  if (publicationReview)
    return (
      <AgendaPublicationWorkspace
        snapshot={data}
        canEdit={canEdit}
        onSaved={accept}
        onClose={() => setPublicationReview(false)}
      />
    );
  return (
    <div class={`pk-stack pk-agenda-editor${target.native ? " pk-agenda-editor--native-drag" : ""}`}>
      {settings && canEdit && (
        <AgendaSettings
          snapshot={data}
          timeStep={scheduling.timeStep}
          onTimeStepChange={scheduling.setTimeStep}
          onSaved={accept}
          onClose={() => setSettings(false)}
        />
      )}
      {roomSelection.dialog}
      {moving && canEdit && (
        <SessionMove snapshot={data} session={moving} onApply={scheduling.apply} onClose={() => setMoving(null)} />
      )}
      {swapping && canEdit && (
        <SessionSwap snapshot={data} first={swapping} onApply={scheduling.apply} onClose={() => setSwapping(null)} />
      )}
      {duplicating && canEdit && (
        <SessionDuplicate snapshot={data} session={duplicating} onSaved={accept} onClose={() => setDuplicating(null)} />
      )}
      <AgendaCreationDialogs
        session={
          editing !== undefined && canEdit
            ? {
                snapshot: data,
                occurrence: editing ?? undefined,
                initialSchedule: editing === null ? newWindow : undefined,
                onSaved: accept,
                onClose: () => setEditing(undefined),
              }
            : undefined
        }
        breaks={
          addingBreak && canEdit
            ? {
                snapshot: data,
                days,
                viewedDay: activeDay?.date,
                onSaved: accept,
                onClose: () => setAddingBreak(false),
              }
            : undefined
        }
      />
      <AgendaWorkspaceHeader view={view} onViewChange={setView} actions={workspaceActions} />
      <AgendaWorkspacePanels view={view}>
        {view === "agenda" && <AgendaDayNavigation days={days} activeDate={activeDay?.date} onSelect={setDay} />}
        {(error || acceptedPlacement.error || source.error) && (
          <ErrorAlert error={error || acceptedPlacement.error || source.error!} />
        )}
        {canEdit && view === "agenda" && scheduling.bar}
        {view === "agenda" && (
          <>
            <div class="pk-agenda-editor__planning">
              <AgendaPointerPlacement
                snapshot={data}
                timeStep={scheduling.timeStep}
                disabled={!canEdit || interactionLock.locked || busy || scheduling.applying || acceptedPlacement.busy}
                onMove={move}
                onResize={resize}
                onResizeStart={scheduling.resizeStart}
                onRoomResize={(id, roomIds) => void scheduling.setRooms(id, roomIds)}
              >
                <AgendaWindowSelection
                  disabled={
                    !canEdit ||
                    interactionLock.locked ||
                    busy ||
                    scheduling.applying ||
                    acceptedPlacement.busy ||
                    Boolean(dragged || resizing || acceptedPlacement.selected)
                  }
                  onSelect={createSession}
                >
                  <div class="pk-agenda-editor__calendar">
                    {(dragged || resizing) && (
                      <div class="pk-agenda-editor__selection-status">
                        <AgendaSelectionStatus
                          title={
                            data.occurrences.find((value) => value.id === (resizing || dragged))?.title ??
                            "selected session"
                          }
                          resizing={Boolean(resizing)}
                          busy={busy}
                          onCancel={target.cancel}
                        />
                      </div>
                    )}
                    {(scheduling.applying || acceptedPlacement.busy) && <Spinner label="Saving session placement…" />}
                    {activeDay && <AgendaGeometry day={activeDay} />}
                    {activeDay ? (
                      <ContentAgenda
                        days={[activeDay]}
                        speakers={[]}
                        timeZone={data.timeZone}
                        editor={{
                          sidebar: view === "agenda" && (
                            <AgendaPlanningSources
                              snapshot={data}
                              canEdit={canEdit}
                              open={sourcesOpen}
                              onClose={() => setSourcesOpen(false)}
                              timeStep={scheduling.timeStep}
                              viewedDay={activeDay?.date}
                              placement={acceptedPlacement}
                              target={target}
                              onSaved={accept}
                              locked={interactionLock.locked}
                              busy={busy || scheduling.applying || acceptedPlacement.busy}
                              actions={actions}
                              onReview={(id) => {
                                setImportProposalIds([id]);
                                setImporting(true);
                              }}
                            />
                          ),
                          toolbarControls: (
                            <AgendaSourcesControl
                              eventSlug={data.eventSlug}
                              open={sourcesOpen}
                              onToggle={() => setSourcesOpen((value) => !value)}
                            />
                          ),
                          roomHeader: canEdit
                            ? (location) => (
                                <AgendaRoomQuickEdit
                                  snapshot={data}
                                  room={data.rooms.find((room) => room.id === location.id)}
                                  onSaved={accept}
                                  onEdit={roomEditor.edit}
                                />
                              )
                            : undefined,
                          addLocation: canEdit ? <AgendaRoomQuickEdit snapshot={data} onSaved={accept} /> : undefined,
                          session: (id) =>
                            agendaSessionInteractions({
                              occurrence: data.occurrences.find((value) => value.id === id)!,
                              canEdit,
                              canReview: canReviewAppearances,
                              locked: interactionLock.locked,
                              busy: busy || scheduling.applying || acceptedPlacement.busy,
                              target,
                              scheduling,
                              cancelProposal: acceptedPlacement.cancel,
                              actions: (close) =>
                                actions(
                                  data.occurrences.find((value) => value.id === id)!,
                                  close,
                                ),
                            }),
                          dropTarget: (startAt, roomId) =>
                            canEdit && !interactionLock.locked ? (
                              <AgendaBoardDropTarget
                                snapshot={data}
                                placement={acceptedPlacement}
                                instant={startAt}
                                roomId={roomId}
                                timeStep={scheduling.timeStep}
                                dragged={dragged}
                                resizing={resizing}
                                busy={busy || scheduling.applying || acceptedPlacement.busy}
                                invalidResize={invalidResizeTarget}
                                move={move}
                                resize={resize}
                              />
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
                  </div>
                </AgendaWindowSelection>
              </AgendaPointerPlacement>
            </div>
          </>
        )}
        {view === "sessions" && (
          <AgendaSessionTable
            retainUrlStateOnUnmount
            key={data.revision}
            data={data}
            days={days}
            canAct={canEdit || canReviewAppearances}
            actions={actions}
            toolbar={canEdit ? scheduling.bar : undefined}
            onNewSession={canEdit ? () => createSession() : undefined}
            onEdit={canEdit ? setEditing : undefined}
            selection={canEdit ? scheduling.selection : undefined}
            onData={scheduling.onTableData}
          />
        )}
        {view === "locations" && (
          <Suspense fallback={<Spinner label="Loading locations…" />}>
            <Locations snapshot={data} canEdit={canEdit} onEdit={roomEditor.edit} onNew={roomEditor.create} />
          </Suspense>
        )}
        {view === "library" && (
          <ContentLibrary snapshot={data} canEdit={canEdit} onSaved={accept} onClose={() => setView("agenda")} />
        )}
        {view === "staffing" && (
          <StaffingEditor
            snapshot={data}
            canEdit={canEdit}
            onSaved={accept}
            teamEligibilityPath={teamEligibilityPath}
          />
        )}
      </AgendaWorkspacePanels>
    </div>
  );
}
