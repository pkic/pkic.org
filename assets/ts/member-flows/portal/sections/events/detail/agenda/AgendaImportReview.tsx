import { agendaTransferExportQuerySchema } from "../../../../../../../shared/schemas/route-contracts-agenda-transfer";
import { ServerSearchSelect } from "../../../../../../components/ServerSearchSelect";
import { sessionAppearanceChoicesSchema } from "../../../../../../../shared/schemas/event-session-history";
import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  agendaTransferSchema,
  transferPrepareSchema,
  transferReviewSchema,
  transferApplySchema,
  transferApplyResponseSchema,
  type AgendaTransferMode,
} from "../../../../../../../shared/schemas/event-agenda-transfer";
import { agendaTransferModePolicy } from "../../../../../../../shared/event-agenda-transfer";
import { agendaPeopleListSchema, type AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";
import { UserPicker, type PickedUser } from "../../../../../../components/UserPicker";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Button } from "../../../../../../ui/Button";
import { DownloadAction } from "../../../../../../ui/DownloadAction";
import { Panel, PanelHeader, PanelBody } from "../../../../../../ui/Panel";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { FormSection } from "../../../../../../ui/FormSection";
import { formatNumber } from "../../../../../../../shared/format-number";
import { formatDateTimeInZone } from "../../../../../../../shared/format-date";
type Document = z.infer<typeof agendaTransferSchema>;
type Resolutions = z.infer<typeof transferPrepareSchema>["resolutions"];
const modeLabels: Record<AgendaTransferMode, string> = {
  archive: "Historical archive, unpublished",
  current: "Current agenda, keeps times and locations",
  copy_as_new: "Copy as new, unscheduled and private",
};
export function AgendaImportReview({
  snapshot,
  onSaved,
  onClose,
}: {
  snapshot: AgendaSnapshot;
  onSaved: (s: AgendaSnapshot) => void;
  onClose: () => void;
}) {
  const [exportOffset, setExportOffset] = useState(0);
  const [pickedPeople, setPickedPeople] = useState<Record<string, PickedUser | null>>({});
  const exportForm = useContractForm(agendaTransferExportQuerySchema, { offset: exportOffset, limit: 100 });
  const [document, setDocument] = useState<Document | null>(null),
    [resolutions, setResolutions] = useState<Resolutions>({ people: {}, rooms: {}, media: {}, rows: {} }),
    [mode, setMode] = useState<AgendaTransferMode>("archive");
  const [review, setReview] = useState<z.infer<typeof transferReviewSchema> | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [timing, setTiming] = useState(false),
    [archive, setArchive] = useState(false);
  const body = {
    expectedRevision: snapshot.revision,
    mode,
    document,
    resolutions,
    reviewDigest: review?.digest ?? "",
    acknowledgeInferredTiming: timing,
    acknowledgeArchiveRepresentation: archive,
  };
  const form = useContractForm(transferApplySchema, body);
  function changed(next: Resolutions) {
    setResolutions(next);
    setReview(null);
  }
  async function load(file: File | undefined) {
    if (!file) return;
    try {
      setDocument(agendaTransferSchema.parse(JSON.parse(await file.text())));
      setReview(null);
      setError("");
    } catch (e) {
      setError(form.refuse(e));
    }
  }
  async function run(apply: boolean) {
    setBusy(true);
    try {
      if (apply) {
        const checked = form.submit();
        if (!checked.data) {
          setError(checked.message);
          return;
        }
        const result = await postJson(
          `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/transfers`,
          checked.data,
          transferApplyResponseSchema,
        );
        onSaved(result.agenda);
        onClose();
      } else {
        const checked = transferPrepareSchema.parse(body);
        setReview(
          await postJson(
            `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/transfers/reviews`,
            checked,
            transferReviewSchema,
          ),
        );
      }
      setError("");
    } catch (e) {
      setError(form.refuse(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel aria-label="Review versioned agenda import">
      <PanelHeader title="Import or export versioned agenda">
        <Button onClick={onClose}>Back to agenda</Button>
      </PanelHeader>
      <PanelBody>
        <div class="pk-stack">
          <FormSection
            title="Export"
            layout="stack"
            description="Download up to 100 sessions per file as a versioned agenda document."
          >
            <Field label="Export start position" {...exportForm.of("offset")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="offset"
                  type="number"
                  value={exportOffset}
                  onInput={(event) => {
                    const checked = agendaTransferExportQuerySchema.safeParse({
                      offset: event.currentTarget.value,
                      limit: 100,
                    });
                    if (checked.success) setExportOffset(checked.data.offset);
                  }}
                />
              )}
            </Field>
            <div class="pk-cluster">
              <DownloadAction
                label={`Download sessions ${formatNumber(exportOffset + 1)}–${formatNumber(exportOffset + 100)} (versioned agenda JSON)`}
                href={`/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/transfers/exports?limit=100&offset=${exportOffset}`}
                filename={`agenda-${snapshot.eventSlug}-sessions-${exportOffset + 1}-${exportOffset + 100}.json`}
              />
            </div>
          </FormSection>
          <FormSection
            title="Import"
            layout="stack"
            description="Import a versioned document into the draft. Resolve every person, location and asset before applying. Imported material still requires the existing release review."
          >
            {error && <ErrorAlert error={error} />}
            <form
              noValidate
              {...form.handlers}
              class="pk-stack"
              onSubmit={(e) => {
                e.preventDefault();
                void run(false);
              }}
            >
              <Field label="Versioned agenda JSON" {...form.of("document")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="document"
                    type="file"
                    accept="application/json,.json"
                    onChange={(e) => void load(e.currentTarget.files?.[0])}
                  />
                )}
              </Field>
              <Field label="Import behavior" {...form.of("mode")}>
                {(control) => (
                  <Select
                    {...control}
                    name="mode"
                    value={mode}
                    onChange={(e) => {
                      setMode(transferPrepareSchema.shape.mode.parse(e.currentTarget.value));
                      setReview(null);
                    }}
                  >
                    {transferPrepareSchema.shape.mode.options.map((value) => (
                      <option value={value}>{modeLabels[value]}</option>
                    ))}
                  </Select>
                )}
              </Field>
              {document?.people.map((person) => (
                <Field label={`Canonical person: ${person.label}`} {...form.of("resolutions")}>
                  {(control) => (
                    <UserPicker
                      responseSchema={agendaPeopleListSchema}
                      endpoint={`/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/people`}
                      sort="name"
                      value={pickedPeople[person.ref] ?? null}
                      inputProps={{ ...control, name: `person-${person.ref}` }}
                      onChange={(picked) => {
                        setPickedPeople({ ...pickedPeople, [person.ref]: picked });
                        changed({
                          ...resolutions,
                          people: {
                            ...resolutions.people,
                            [person.ref]: {
                              userId: picked?.id ?? person.canonicalUserId ?? "",
                              actingIdentityId: null,
                            },
                          },
                        });
                      }}
                    />
                  )}
                </Field>
              ))}
              {document?.people.map((person) => {
                const userId = resolutions.people[person.ref]?.userId ?? person.canonicalUserId;
                const at = document.occurrences.find((row) => row.personRefs.includes(person.ref))?.timing.startAt;
                return (
                  userId &&
                  at && (
                    <Field label={`Dated identity: ${person.label}`} {...form.of("resolutions")}>
                      {(control) => (
                        <ServerSearchSelect
                          {...control}
                          searchLabel="Acting identity"
                          value={
                            resolutions.people[person.ref]
                              ? resolutions.people[person.ref].actingIdentityId
                              : person.actingIdentityId
                          }
                          allowEmpty
                          catalog={{
                            endpoint: `/api/v1/events/${encodeURIComponent(snapshot.eventSlug)}/agenda/transfers/identities`,
                            responseSchema: sessionAppearanceChoicesSchema,
                            resolveItems: (response) => response.identities,
                            resolvePage: (response) => response.page,
                            itemKey: (item) => item.id,
                            itemLabel: (item) => [item.organizationName, item.jobTitle].filter(Boolean).join(" · "),
                            params: { userId, at },
                            sort: "name",
                          }}
                          onChange={(identity) =>
                            changed({
                              ...resolutions,
                              people: {
                                ...resolutions.people,
                                [person.ref]: { userId, actingIdentityId: identity?.id ?? null },
                              },
                            })
                          }
                        />
                      )}
                    </Field>
                  )
                );
              })}
              {document?.occurrences.flatMap((row) =>
                row.media.map((media) => (
                  <Field label={`Public asset: ${media.authoredReference}`} {...form.of("resolutions")}>
                    {(control) => (
                      <TextInput
                        {...control}
                        name={`media-${row.ref}-${media.kind}`}
                        value={resolutions.media[media.authoredReference] ?? media.publicUrl ?? ""}
                        onInput={(event) =>
                          changed({
                            ...resolutions,
                            media: { ...resolutions.media, [media.authoredReference]: event.currentTarget.value },
                          })
                        }
                      />
                    )}
                  </Field>
                )),
              )}
              {document?.rooms.map((room) => (
                <Field label={`Location: ${room.label}`} {...form.of("resolutions")}>
                  {(control) => (
                    <Select
                      {...control}
                      name={`room-${room.ref}`}
                      value={resolutions.rooms[room.ref] ?? room.canonicalRoomId ?? ""}
                      onChange={(e) =>
                        changed({ ...resolutions, rooms: { ...resolutions.rooms, [room.ref]: e.currentTarget.value } })
                      }
                    >
                      <option value="">Choose a location</option>
                      {snapshot.rooms.map((choice) => (
                        <option value={choice.id}>{choice.name}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
              {document?.occurrences.map((row) => (
                <Field label={`Row: ${row.fields.title}`} {...form.of("resolutions")}>
                  {(control) => (
                    <Select
                      {...control}
                      name={`row-${row.ref}`}
                      value={resolutions.rows[row.ref] ?? "import"}
                      onChange={(e) =>
                        changed({
                          ...resolutions,
                          rows: {
                            ...resolutions.rows,
                            [row.ref]: transferPrepareSchema.shape.resolutions.shape.rows.valueType.parse(
                              e.currentTarget.value,
                            ),
                          },
                        })
                      }
                    >
                      {transferPrepareSchema.shape.resolutions.shape.rows.valueType.options.map((value) => (
                        <option value={value}>{value.replaceAll("_", " ")}</option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
              {document?.occurrences.map((row) => (
                <section class="pk-stack" aria-label={`Timing for ${row.fields.title}`}>
                  <p>
                    <strong>{row.fields.title}</strong>
                    <br />
                    {resolutions.rows[row.ref] === "skip"
                      ? "This session will be skipped."
                      : resolutions.rows[row.ref] === "retain_local"
                        ? "The existing local session will be kept."
                        : !agendaTransferModePolicy[mode].retainsSource
                          ? "Imported as an unscheduled draft. Choose its day, time and locations afterward."
                          : row.timing.startAt
                            ? `${formatDateTimeInZone(row.timing.startAt, row.timing.timeZone)}${row.timing.endAt ? ` – ${formatDateTimeInZone(row.timing.endAt, row.timing.timeZone)}` : " · End time needs review"} (${row.timing.timeZone})`
                            : "No scheduled time in the source. Review the timing before using this historical session."}
                  </p>
                  {agendaTransferModePolicy[mode].retainsSource &&
                    resolutions.rows[row.ref] !== "skip" &&
                    resolutions.rows[row.ref] !== "retain_local" &&
                    (row.timing.endSource === "duration" ||
                      row.timing.endSource === "next_start" ||
                      row.timing.transitionSource === "default") && (
                      <p>Some timing was inferred. Check the source details before approving the import.</p>
                    )}
                  <Panel aria-label={`Source details for ${row.fields.title}`}>
                    <PanelHeader title={`Source details for ${row.fields.title}`} headingLevel={4} />
                    <PanelBody>
                      <DescriptionList
                        items={[
                          {
                            term: "Source schedule",
                            value: `${row.timing.startAt ? formatDateTimeInZone(row.timing.startAt, row.timing.timeZone) : "Start time not supplied"}${row.timing.endAt ? ` – ${formatDateTimeInZone(row.timing.endAt, row.timing.timeZone)}` : " · End time not determined"} (${row.timing.timeZone})`,
                          },
                          {
                            term: "End time basis",
                            value: {
                              explicit: "Supplied in the source",
                              duration: "Calculated from the session duration; review required",
                              next_start: "Inferred from the following session; review required",
                              unresolved: "Not determined; review required",
                            }[row.timing.endSource],
                          },
                          {
                            term: "Time between sessions",
                            value: `${formatNumber(row.timing.transitionMinutes)} minutes · ${
                              {
                                explicit: "supplied in the source",
                                default: "default allowance; review required",
                                none: "no allowance",
                              }[row.timing.transitionSource]
                            }`,
                          },
                          { term: "Original link anchor", value: row.sourceAnchor ?? "No original anchor" },
                          { term: "Source reference", value: row.sourceKey },
                          ...(row.sourcePath ? [{ term: "Source path", value: row.sourcePath }] : []),
                        ]}
                      />
                    </PanelBody>
                  </Panel>
                </section>
              ))}
              {review && (
                <div role="status">
                  <p>
                    {formatNumber(review.imported)} new sessions · {formatNumber(review.skipped)} existing sessions.{" "}
                    {review.ready ? "Ready for your approval." : "Resolve the blocking findings and review again."}
                  </p>
                  <ul>
                    {review.findings.map((f) => (
                      <li>
                        {f.severity}: {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Field label="Timing review" {...form.of("acknowledgeInferredTiming")}>
                {(control) => (
                  <Checkbox
                    {...control}
                    name="acknowledgeInferredTiming"
                    label="I reviewed inferred end times and transitions."
                    checked={timing}
                    onChange={(e) => setTiming(e.currentTarget.checked)}
                  >
                    I reviewed inferred end times and transitions.
                  </Checkbox>
                )}
              </Field>
              <Field label="Speaker representation" {...form.of("acknowledgeArchiveRepresentation")}>
                {(control) => (
                  <Checkbox
                    {...control}
                    name="acknowledgeArchiveRepresentation"
                    label="I reviewed the imported speaker representation."
                    checked={archive}
                    onChange={(e) => setArchive(e.currentTarget.checked)}
                  >
                    I reviewed the imported speaker representation. Materials remain unpublished pending review.
                  </Checkbox>
                )}
              </Field>
              <div class="pk-cluster">
                <Button onClick={onClose}>Cancel</Button>
                <Button type="submit" disabled={busy || !document}>
                  Review import
                </Button>
                <Button variant="primary" disabled={busy || !review?.ready} onClick={() => void run(true)}>
                  Apply to draft
                </Button>
              </div>
            </form>
          </FormSection>
        </div>
      </PanelBody>
    </Panel>
  );
}
