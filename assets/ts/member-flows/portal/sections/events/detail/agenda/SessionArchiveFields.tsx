import { useState } from "preact/hooks";
import {
  sessionAppearanceSchema,
  type SessionProposalRepresentation,
} from "../../../../../../../shared/schemas/event-session-history";
import type { AgendaOccurrence } from "../../../../../../../shared/schemas/event-agenda";
import { sessionMaterialVersionsSchema } from "../../../../../../../shared/schemas/event-session-history";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";
import { sessionAppearanceChoicesSchema } from "../../../../../../../shared/schemas/event-session-history";
import type { SessionAppearance, SessionMaterial } from "../../../../../../../shared/schemas/event-session-history";
import { sessionMaterialSchema } from "../../../../../../../shared/schemas/event-session-history";
import { Field } from "../../../../../../ui/Field";
import { TextInput, Textarea, Select } from "../../../../../../ui/TextControl";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Avatar } from "../../../../../../ui/Avatar";
import type { LegacyAgendaDownload } from "../../../../../../../shared/schemas/event-agenda-legacy-fragments";
export function AppearanceFields({
  appearances,
  speakers,
  sourceRepresentations,
  onChange,
  slug,
  occurrenceId,
}: {
  slug: string;
  occurrenceId: string;
  appearances: SessionAppearance[];
  speakers: AgendaOccurrence["speakers"];
  sourceRepresentations: SessionProposalRepresentation[];
  onChange: (value: SessionAppearance[]) => void;
}) {
  const [drafts, setDrafts] = useState(() =>
    speakers.map((speaker) => {
      const approved = appearances.find((appearance) => appearance.userId === speaker.userId);
      const source = sourceRepresentations.find((selection) => selection.userId === speaker.userId);
      return {
        userId: speaker.userId,
        displayName: approved?.displayName ?? speaker.displayName,
        actingIdentityId: approved
          ? approved.actingIdentityId
          : source?.selectedAt
            ? source.actingIdentityId
            : undefined,
        organizationName: approved ? approved.organizationName : (source?.snapshot?.organizationName ?? null),
        jobTitle: approved ? approved.jobTitle : (source?.snapshot?.jobTitle ?? null),
        biography: approved ? approved.biography : (source?.snapshot?.biography ?? ""),
        photoUrl: approved?.photoUrl ?? null,
        approvedAt: approved?.approvedAt ?? null,
      };
    }),
  );
  const [approvalError, setApprovalError] = useState("");
  const [offset, setOffset] = useState(0),
    [query, setQuery] = useState("");
  const catalog = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(occurrenceId)}/history/identities?limit=200&offset=${offset}&q=${encodeURIComponent(query)}`,
        sessionAppearanceChoicesSchema,
      ),
    [slug, occurrenceId, offset, query],
  );
  const update = (index: number, patch: Partial<SessionAppearance>) => {
    setDrafts(drafts.map((value, i) => (i === index ? { ...value, ...patch, approvedAt: null } : value)));
    onChange(appearances.filter((appearance) => appearance.userId !== drafts[index]!.userId));
    setApprovalError("");
  };
  const approve = (index: number) => {
    const checked = sessionAppearanceSchema.safeParse({ ...drafts[index], approvedAt: new Date().toISOString() });
    if (!checked.success) {
      setApprovalError(
        checked.error.issues
          .map((issue) =>
            issue.path.includes("actingIdentityId")
              ? "Choose an individual appearance or an owned representation before approval."
              : issue.message,
          )
          .join(" "),
      );
      return;
    }
    onChange([...appearances.filter((appearance) => appearance.userId !== checked.data.userId), checked.data]);
    setDrafts(drafts.map((value, i) => (i === index ? checked.data : value)));
    setApprovalError("");
  };
  return (
    <section>
      <h3>Speaker representation review</h3>
      <p>These credits remain attached to this event revision when a speaker changes organization or profile.</p>
      {catalog.error && <ErrorAlert error={catalog.error} />}
      {approvalError && <ErrorAlert error={approvalError} />}
      <Field label="Find acting representation">
        {(control) => (
          <TextInput
            {...control}
            value={query}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setOffset(0);
            }}
          />
        )}
      </Field>
      <Button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 200))}>
        Previous identities
      </Button>
      <Button type="button" disabled={!catalog.data?.page.hasMore} onClick={() => setOffset(offset + 200)}>
        Next identities
      </Button>

      {drafts.map((person, index) => {
        const profileCandidate = speakers.find((speaker) => speaker.userId === person.userId)?.profileCandidate;
        const currentPortrait =
          catalog.data?.portraits.find((candidate) => candidate.userId === person.userId)?.photoUrl ??
          profileCandidate?.photoUrl;
        return (
          <fieldset key={person.userId}>
            <legend>{person.displayName}</legend>
            <p>{person.approvedAt ? "Representation approved" : "Representation needs review"}</p>
            <Field label="Display name">
              {(control) => (
                <>
                  <TextInput
                    {...control}
                    value={person.displayName}
                    onInput={(e) => update(index, { displayName: e.currentTarget.value })}
                  />
                </>
              )}
            </Field>
            <Field
              label="Representation at this event"
              help="Choose the canonical identity that represented this speaker at the session date."
            >
              {(control) => (
                <Select
                  {...control}
                  value={person.actingIdentityId === undefined ? "__needs_review" : (person.actingIdentityId ?? "")}
                  onChange={(e) => {
                    const identity = catalog.data?.identities.find(
                      (item) => item.id === e.currentTarget.value && item.userId === person.userId,
                    );
                    if (e.currentTarget.value !== "" && !identity) return;
                    update(
                      index,
                      identity
                        ? {
                            actingIdentityId: identity.id,
                            organizationName: identity.organizationName,
                            jobTitle: identity.jobTitle,
                            biography: identity.biography,
                          }
                        : { actingIdentityId: null, organizationName: null, jobTitle: null },
                    );
                  }}
                >
                  <option value="__needs_review" disabled>
                    Representation needs review
                  </option>
                  <option value="">Individual appearance</option>
                  {catalog.data?.identities
                    ?.filter((item) => item.userId === person.userId)
                    .map((item) => (
                      <option value={item.id}>
                        {[item.organizationName ?? "Individual", item.jobTitle].filter(Boolean).join(" · ")}
                      </option>
                    ))}
                  {person.actingIdentityId &&
                    !catalog.data?.identities.some((item) => item.id === person.actingIdentityId) && (
                      <option value={person.actingIdentityId}>
                        {person.organizationName ?? "Source representation awaiting review"}
                      </option>
                    )}
                </Select>
              )}
            </Field>
            <Field label="Organization at this event">
              {(control) => (
                <>
                  <TextInput
                    {...control}
                    value={person.organizationName ?? ""}
                    onInput={(e) => update(index, { organizationName: e.currentTarget.value || null })}
                  />
                </>
              )}
            </Field>
            <Field label="Role at this event">
              {(control) => (
                <>
                  <TextInput
                    {...control}
                    value={person.jobTitle ?? ""}
                    onInput={(e) => update(index, { jobTitle: e.currentTarget.value || null })}
                  />
                </>
              )}
            </Field>
            <Field label="Approved biography">
              {(control) => (
                <>
                  <Textarea
                    {...control}
                    value={person.biography}
                    onInput={(e) => update(index, { biography: e.currentTarget.value })}
                  />
                </>
              )}
            </Field>
            {profileCandidate?.biography && (
              <Button
                size="sm"
                disabled={person.biography === profileCandidate.biography}
                onClick={() => update(index, { biography: profileCandidate.biography ?? "" })}
              >
                Use profile biography
              </Button>
            )}
            <Field label="Approved portrait URL">
              {(control) => (
                <>
                  <TextInput
                    {...control}
                    value={person.photoUrl ?? ""}
                    onInput={(e) => update(index, { photoUrl: e.currentTarget.value || null })}
                  />
                </>
              )}
            </Field>
            {person.photoUrl && (
              <Avatar
                name={person.displayName}
                src={person.photoUrl}
                size="lg"
                alt={`Selected portrait for ${person.displayName}`}
              />
            )}
            {currentPortrait && (
              <div class="pk-stack">
                {currentPortrait !== person.photoUrl && (
                  <Avatar
                    name={person.displayName}
                    src={currentPortrait}
                    size="lg"
                    alt={`Current portrait for ${person.displayName}`}
                  />
                )}
                <Button
                  type="button"
                  disabled={currentPortrait === person.photoUrl}
                  onClick={() => update(index, { photoUrl: currentPortrait })}
                >
                  Use current portrait
                </Button>
                <p>The selected portrait remains a draft until you approve this event appearance and save.</p>
              </div>
            )}
            <Button type="button" onClick={() => approve(index)}>
              Approve representation for {person.displayName}
            </Button>
          </fieldset>
        );
      })}
    </section>
  );
}
export function MaterialFields({
  slug,
  occurrenceId,
  materials,
  onChange,
  refreshToken = 0,
  legacyDownloads = [],
}: {
  legacyDownloads?: LegacyAgendaDownload[];
  refreshToken?: number;
  slug: string;
  occurrenceId: string;
  materials: SessionMaterial[];
  onChange: (value: SessionMaterial[]) => void;
}) {
  const [offset, setOffset] = useState(0),
    [query, setQuery] = useState("");
  const catalog = useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/occurrences/${encodeURIComponent(occurrenceId)}/history/materials?limit=200&offset=${offset}&q=${encodeURIComponent(query)}`,
        sessionMaterialVersionsSchema,
      ),
    [slug, occurrenceId, offset, query, refreshToken],
  );
  const update = (index: number, patch: Partial<SessionMaterial>) =>
    onChange(materials.map((value, i) => (i === index ? { ...value, ...patch } : value)));
  return (
    <section>
      <h3>Material release</h3>
      <p>
        Uploaded files remain private until rights, consent, validation and release are approved. Publish the agenda
        after saving a release or withdrawal.
      </p>
      {catalog.error && <ErrorAlert error={catalog.error} />}
      <Field label="Find uploaded version">
        {(control) => (
          <TextInput
            {...control}
            value={query}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setOffset(0);
            }}
          />
        )}
      </Field>
      <Button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 200))}>
        Previous uploads
      </Button>
      <Button type="button" disabled={!catalog.data?.page.hasMore} onClick={() => setOffset(offset + 200)}>
        Next uploads
      </Button>
      {materials.map((material, index) => (
        <fieldset key={material.id}>
          <legend>{material.title || "New material"}</legend>
          <Field label="Material title">
            {(control) => (
              <>
                <TextInput
                  {...control}
                  value={material.title}
                  onInput={(e) => update(index, { title: e.currentTarget.value })}
                />
              </>
            )}
          </Field>
          <Field label="Material type">
            {(control) => (
              <>
                <Select
                  {...control}
                  value={material.kind}
                  onChange={(e) =>
                    update(index, {
                      kind: sessionMaterialSchema.shape.kind.parse(e.currentTarget.value),
                      ...(e.currentTarget.value !== "presentation"
                        ? { presentationVersionId: null, presentationSource: "proposal", legacyDownloadUrl: null }
                        : {}),
                    })
                  }
                >
                  {sessionMaterialSchema.shape.kind.options.map((kind) => (
                    <option value={kind}>{kind}</option>
                  ))}
                </Select>
              </>
            )}
          </Field>
          {material.presentationSource === "session" && material.presentationVersionId ? (
            <p>
              The public delivery URL is generated from this uploaded version. Public access requires approved
              publication.
            </p>
          ) : (
            <Field label="Public delivery URL">
              {(control) => (
                <>
                  <TextInput
                    {...control}
                    value={material.url}
                    onInput={(e) => update(index, { url: e.currentTarget.value })}
                  />
                </>
              )}
            </Field>
          )}
          {material.kind === "presentation" && (
            <Field
              label="Uploaded presentation version"
              help="Choose a session upload. Release requires an approved upload review. Session uploads receive a generated public delivery URL."
            >
              {(control) => (
                <Select
                  {...control}
                  value={
                    material.presentationVersionId
                      ? `${material.presentationSource}:${material.presentationVersionId}`
                      : ""
                  }
                  onChange={(event) => {
                    const version = catalog.data?.versions.find(
                      (value) => `${value.source}:${value.id}` === event.currentTarget.value,
                    );
                    update(index, {
                      legacyDownloadUrl: null,
                      presentationVersionId: version?.id ?? null,
                      presentationSource: version?.source ?? "proposal",
                      ...(version ? { version: version.version } : {}),
                      ...(version?.source === "session" ? { url: "" } : {}),
                    });
                  }}
                >
                  <option value="">External material / no uploaded version</option>
                  {catalog.data?.versions.map((version) => (
                    <option value={`${version.source}:${version.id}`}>
                      {version.source === "session" ? "Session upload" : "Proposal upload"} ·{" "}
                      {version.fileName ?? version.title} · version {version.version} ·{" "}
                      {version.reviewStatus ?? "awaiting review"}
                    </option>
                  ))}
                  {material.presentationVersionId &&
                    !catalog.data?.versions.some(
                      (version) =>
                        version.id === material.presentationVersionId && version.source === material.presentationSource,
                    ) && (
                      <option value={`${material.presentationSource}:${material.presentationVersionId}`}>
                        Saved {material.presentationSource} upload · version {material.version}
                      </option>
                    )}
                </Select>
              )}
            </Field>
          )}
          {material.kind === "presentation" &&
            material.presentationSource === "session" &&
            material.presentationVersionId && (
              <Field
                label="Historical download link"
                help="Choose an original link recorded for this presentation. Saving verifies that it matches the uploaded file. Release approval is separate."
              >
                {(control) => (
                  <Select
                    {...control}
                    value={material.legacyDownloadUrl ?? ""}
                    onChange={(event) => update(index, { legacyDownloadUrl: event.currentTarget.value || null })}
                  >
                    <option value="">No historical download link</option>
                    {legacyDownloads.map((download) => (
                      <option value={download.url} disabled={download.pdfDigest === null || download.pdfBytes === null}>
                        {download.url}
                        {download.pdfDigest === null || download.pdfBytes === null ? " · PDF evidence pending" : ""}
                      </option>
                    ))}
                    {material.legacyDownloadUrl &&
                      !legacyDownloads.some((download) => download.url === material.legacyDownloadUrl) && (
                        <option value={material.legacyDownloadUrl} disabled>
                          Saved link · receipt unavailable
                        </option>
                      )}
                  </Select>
                )}
              </Field>
            )}
          <Field label="Version">
            {(control) => (
              <>
                <TextInput
                  {...control}
                  type="number"
                  min="1"
                  value={material.version}
                  onInput={(e) => update(index, { version: Number(e.currentTarget.value) })}
                />
              </>
            )}
          </Field>
          <Checkbox
            checked={material.rightsConfirmed}
            onChange={(e) => update(index, { rightsConfirmed: e.currentTarget.checked })}
            label="Rights confirmed"
          />
          <Checkbox
            checked={material.consentConfirmed}
            onChange={(e) => update(index, { consentConfirmed: e.currentTarget.checked })}
            label="Speaker consent confirmed"
          />
          <Checkbox
            checked={material.validated}
            onChange={(e) => update(index, { validated: e.currentTarget.checked })}
            label="File and accessibility reviewed"
          />
          <Field label="Release status">
            {(control) => (
              <>
                <Select
                  {...control}
                  value={material.status}
                  onChange={(e) =>
                    update(index, {
                      status: sessionMaterialSchema.shape.status.parse(e.currentTarget.value),
                      approvedAt: e.currentTarget.value === "approved" ? new Date().toISOString() : null,
                    })
                  }
                >
                  {sessionMaterialSchema.shape.status.options.map((status) => (
                    <option value={status}>{status}</option>
                  ))}
                </Select>
              </>
            )}
          </Field>
          <Button onClick={() => onChange(materials.filter((_, i) => i !== index))}>Remove from draft</Button>
        </fieldset>
      ))}
      <Button
        onClick={() =>
          onChange([
            ...materials,
            {
              id: crypto.randomUUID(),
              title: "",
              kind: "presentation",
              url: "",
              presentationVersionId: null,
              legacyDownloadUrl: null,
              presentationSource: "proposal",
              version: 1,
              rightsConfirmed: false,
              consentConfirmed: false,
              validated: false,
              status: "draft",
              approvedAt: null,
            },
          ])
        }
      >
        Add material release
      </Button>
    </section>
  );
}
