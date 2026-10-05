import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { RowActions } from "../../../../../../ui/RowActions";
import { formatNumber } from "../../../../../../../shared/format-number";
import { useMemo, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import {
  agendaContentSchema,
  agendaContentsResponseSchema,
  agendaContentCreateSchema,
  agendaContentPatchSchema,
  agendaContentCopySchema,
  agendaContentPlacementResponseSchema,
} from "../../../../../../../shared/schemas/event-agenda-content";
import {
  agendaSnapshotSchema,
  type AgendaSnapshot,
  agendaPeopleListSchema,
  agendaCreditRoleSchema,
} from "../../../../../../../shared/schemas/event-agenda";
import { postJson, patchJson, getJson } from "../../../../../../shared/api-client";
import { ApiDataTable, type ApiTableActions } from "../../../../../../components/ApiDataTable";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import { UserPicker, type PickedUser } from "../../../../../../components/UserPicker";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Textarea, Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { HistoricalMappingReview } from "./HistoricalMappingReview";
type Content = z.infer<typeof agendaContentSchema>;
export function ContentLibrary({
  snapshot,
  canEdit,
  onSaved,
}: {
  snapshot: AgendaSnapshot;
  canEdit: boolean;
  onSaved: (next: AgendaSnapshot) => void;
}) {
  const endpoint = `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda`,
    table = useRef<ApiTableActions | null>(null);
  const [mode, setMode] = useState<"list" | "edit" | "copy">("list");
  const [selected, setSelected] = useState<Content | null>(null),
    [title, setTitle] = useState(""),
    [track, setTrack] = useState(""),
    [description, setDescription] = useState(""),
    [kind, setKind] = useState<"session" | "break" | "plenary">("session"),
    [speakers, setSpeakers] = useState<string[]>([]),
    [picked, setPicked] = useState<PickedUser | null>(null),
    [resolve, setResolve] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [roles, setRoles] = useState<Record<string, z.infer<typeof agendaCreditRoleSchema>>>({});
  const [sourceSlug, setSourceSlug] = useState(""),
    [source, setSource] = useState<Content | null>(null);
  const content = {
    title,
    track: track || null,
    description,
    kind,
    speakerUserIds: speakers,
    speakerRoles: Object.fromEntries(speakers.map((id) => [id, roles[id] ?? "speaker"])),
  };
  const historicalReview = selected?.review?.incomingHistoricalMetadata ?? [];
  const historicalReviewBlocked = historicalReview.some((entry) => entry.reviewIssues.length > 0);
  const form = useContractForm(agendaContentCreateSchema, { expectedRevision: snapshot.revision, content });
  const copyForm = useContractForm(agendaContentCopySchema, {
    expectedRevision: snapshot.revision,
    sourceEventSlug: sourceSlug,
    sourceContentId: source?.id ?? "",
  });
  const catalog = useMemo(
    () => ({
      endpoint: `/api/v1/events/${encodeURIComponent(sourceSlug)}/agenda/contents`,
      responseSchema: agendaContentsResponseSchema,
      resolveItems: (response: z.infer<typeof agendaContentsResponseSchema>) => response.contents,
      resolvePage: (response: z.infer<typeof agendaContentsResponseSchema>) => response.page,
      itemKey: (item: Content) => item.id,
      itemLabel: (item: Content) => item.title,
      sort: "title",
    }),
    [sourceSlug],
  );
  function edit(item: Content | null) {
    setMode("edit");
    setSelected(item);
    setTitle(item?.title ?? "");
    setTrack(item?.track ?? "");
    setDescription(item?.description ?? "");
    setKind(item?.kind ?? "session");
    setSpeakers(item?.speakerUserIds ?? []);
    setRoles(item?.speakerRoles ?? {});
    setPicked(null);
    setResolve(false);
    setError("");
  }
  async function refresh() {
    onSaved(await getJson(endpoint, agendaSnapshotSchema));
  }
  async function save(event: Event) {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = selected
        ? await patchJson(
            `${endpoint}/contents/${selected.id}`,
            agendaContentPatchSchema.parse({ ...checked.data, resolveSourceReview: resolve }),
            agendaContentSchema,
          )
        : await postJson(`${endpoint}/contents`, checked.data, agendaContentSchema);
      edit(result);
      setMessage(
        "Session content saved. Linked draft occurrences use this content; approved public revisions change only after publication.",
      );
      await refresh();
    } catch (error) {
      setError(form.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  async function place(item: Content, copyAsNew: boolean) {
    setBusy(true);
    setError("");
    try {
      await postJson(
        `${endpoint}/contents/${item.id}/placements`,
        { expectedRevision: snapshot.revision, copyAsNew },
        agendaContentPlacementResponseSchema,
      );
      setMessage(
        copyAsNew
          ? "Independent copy created. Schedule and approve it separately."
          : "Repeated occurrence added. Choose its time, rooms and admission policy in the Sessions view.",
      );
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The occurrence could not be created.");
    } finally {
      setBusy(false);
    }
  }
  async function copy(event: Event) {
    event.preventDefault();
    const checked = copyForm.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await postJson(`${endpoint}/contents/copy`, checked.data, agendaContentSchema);
      edit(result);
      setMessage(
        "Content copied. Dates, rooms, limits, publication, speaker appearance confirmations and registrations were reset.",
      );
      await refresh();
    } catch (error) {
      setError(copyForm.refuse(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel>
      <PanelHeader
        title={
          mode === "list"
            ? "Session library"
            : mode === "copy"
              ? "Reuse session content"
              : selected
                ? "Edit session content"
                : "New session content"
        }
      >
        {mode !== "list" && (
          <Button disabled={busy} onClick={() => setMode("list")}>
            Back to session library
          </Button>
        )}
      </PanelHeader>
      <PanelBody>
        <p>
          Keep the title, abstract and speakers together. Add separate occurrences for repeats, or make an independent
          copy. Content can stay unscheduled.
        </p>
        {mode === "list" && (
          <ApiDataTable<Content, z.infer<typeof agendaContentsResponseSchema>>
            key={snapshot.revision}
            createAction={
              canEdit ? { label: "New session content", onSelect: () => edit(null), disabled: busy } : undefined
            }
            toolbar={
              canEdit
                ? () => (
                    <Button disabled={busy} onClick={() => setMode("copy")}>
                      Reuse from another event
                    </Button>
                  )
                : undefined
            }
            rowAction={canEdit ? (row) => ({ label: `Edit ${row.title}`, onSelect: () => edit(row) }) : undefined}
            endpoint={`${endpoint}/contents`}
            responseSchema={agendaContentsResponseSchema}
            resolve={(result) => result.contents}
            resolvePage={(result) => result.page}
            paginate
            initialSort="title"
            caption="Session content"
            rowKey={(row) => row.id}
            actionsRef={table}
            searchPlaceholder="Find session content…"
            columns={[
              { header: "Session", sort: { asc: "title", desc: "-title" }, cell: (row) => row.title },
              { header: "Occurrences", align: "end", width: "fit", cell: (row) => formatNumber(row.occurrenceCount) },
              {
                header: "Source review",
                cell: (row) => (row.review ? row.review.reason.replaceAll("_", " ") : "Up to date"),
              },
              ...(canEdit
                ? [
                    {
                      header: "Actions",
                      cell: (row: Content) => (
                        <RowActions
                          subject={row.title}
                          actions={[
                            { id: "edit", label: "Edit content", disabled: busy, onSelect: () => edit(row) },
                            {
                              id: "repeat",
                              label: "Add repeat",
                              disabled: busy,
                              onSelect: () => void place(row, false),
                            },
                            { id: "copy", label: "Copy as new", disabled: busy, onSelect: () => void place(row, true) },
                          ]}
                        />
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
        {canEdit && (
          <>
            {mode === "edit" && (
              <form noValidate {...form.handlers} onSubmit={save}>
                <h3>{selected ? "Edit session content" : "New unscheduled session"}</h3>
                <Field label="Title" {...form.of("content.title")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="content.title"
                      value={title}
                      onInput={(event) => setTitle(event.currentTarget.value)}
                    />
                  )}
                </Field>
                <Field
                  label="Track"
                  help="Optional program grouping, separate from the session type and location."
                  {...form.of("content.track")}
                >
                  {(control) => (
                    <TextInput
                      {...control}
                      name="content.track"
                      value={track}
                      onInput={(event) => setTrack(event.currentTarget.value)}
                    />
                  )}
                </Field>
                <Field label="Abstract" {...form.of("content.description")}>
                  {(control) => (
                    <Textarea
                      {...control}
                      name="content.description"
                      value={description}
                      onInput={(event) => setDescription(event.currentTarget.value)}
                    />
                  )}
                </Field>
                <Field label="Kind" {...form.of("content.kind")}>
                  {(control) => (
                    <Select
                      {...control}
                      name="content.kind"
                      value={kind}
                      onChange={(event) => setKind(event.currentTarget.value as typeof kind)}
                    >
                      {agendaContentCreateSchema.shape.content.shape.kind.unwrap().options.map((value) => (
                        <option value={value}>{value}</option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="Add speaker" {...form.of("content.speakerUserIds")}>
                  {(control) => (
                    <UserPicker
                      value={picked}
                      onChange={(person) => {
                        setPicked(person);
                        if (person && !speakers.includes(person.id)) setSpeakers([...speakers, person.id]);
                      }}
                      inputProps={{ ...control, name: "content.speakerUserIds" }}
                      endpoint={`${endpoint}/people`}
                      responseSchema={agendaPeopleListSchema}
                      sort="name"
                    />
                  )}
                </Field>
                {speakers.length > 0 && (
                  <ul>
                    {speakers.map((id, index) => (
                      <li key={id}>
                        Speaker {index + 1}
                        <Field
                          label={`Credit role for speaker ${index + 1}`}
                          {...form.of(`content.speakerRoles.${id}`)}
                        >
                          {(control) => (
                            <Select
                              {...control}
                              value={roles[id] ?? "speaker"}
                              onChange={(event) =>
                                setRoles({ ...roles, [id]: agendaCreditRoleSchema.parse(event.currentTarget.value) })
                              }
                            >
                              {agendaCreditRoleSchema.options.map((role) => (
                                <option value={role}>{role.replaceAll("_", " ")}</option>
                              ))}
                            </Select>
                          )}
                        </Field>
                        <Button type="button" onClick={() => setSpeakers(speakers.filter((value) => value !== id))}>
                          Remove speaker
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {selected?.review && (
                  <aside>
                    <p>
                      Source review required: {selected.review.reason.replaceAll("_", " ")}. Your saved content has been
                      preserved.
                    </p>
                    {historicalReview.length > 0 && (
                      <HistoricalMappingReview entries={historicalReview} occurrences={snapshot.occurrences} />
                    )}
                    {selected.review.incoming && (
                      <>
                        <Button
                          type="button"
                          onClick={() => {
                            const incoming = selected.review!.incoming!;
                            setTitle(incoming.title);
                            setTrack(incoming.track ?? "");
                            setDescription(incoming.description);
                            setKind(incoming.kind);
                            setSpeakers(incoming.speakerUserIds);
                            setRoles(incoming.speakerRoles ?? {});
                            setResolve(historicalReview.length === 0);
                          }}
                        >
                          Use incoming source content
                        </Button>
                        <Checkbox
                          label={
                            historicalReview.length > 0
                              ? "Approve the displayed verified historical mappings and source changes"
                              : "Acknowledge source changes and keep my edited content"
                          }
                          disabled={historicalReviewBlocked}
                          checked={resolve}
                          onInput={(event) => setResolve(event.currentTarget.checked)}
                        />
                      </>
                    )}
                  </aside>
                )}
                <Button type="submit" loading={busy}>
                  Save session content
                </Button>
              </form>
            )}
            {mode === "copy" && (
              <form noValidate {...copyForm.handlers} onSubmit={copy}>
                <h3>Reuse content from another event</h3>
                <p>You need access to the source event. Copied content starts with no scheduled occurrence.</p>
                <Field label="Source event slug" {...copyForm.of("sourceEventSlug")}>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="sourceEventSlug"
                      value={sourceSlug}
                      onInput={(event) => {
                        setSourceSlug(event.currentTarget.value);
                        setSource(null);
                      }}
                    />
                  )}
                </Field>
                {sourceSlug && (
                  <Field label="Source session" {...copyForm.of("sourceContentId")}>
                    {(control) => (
                      <ServerSearchSelect
                        {...control}
                        catalog={catalog}
                        searchLabel="Source session"
                        value={source?.id ?? null}
                        selectedLabel={source?.title}
                        onChange={setSource}
                      />
                    )}
                  </Field>
                )}
                <Button type="submit" loading={busy}>
                  Copy content into this event
                </Button>
              </form>
            )}
          </>
        )}
        {message && <p role="status">{message}</p>}
        {error && <ErrorAlert error={error} />}
      </PanelBody>
    </Panel>
  );
}
