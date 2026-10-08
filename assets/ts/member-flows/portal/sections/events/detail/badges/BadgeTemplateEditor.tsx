import {
  badgePrintPreviewDocument,
  applyBadgePrintPreviewStyles,
} from "../../../../../../components/event-badges/badge-print-preview-document";
import { useEffect, useRef, useState } from "preact/hooks";
import { importBadgeTemplateHtml, exportBadgeTemplateHtml } from "../../../../../../../shared/badge-template-import";
import {
  compileBadgeTemplate,
  BADGE_PRINT_CONTENT_SECURITY_POLICY,
} from "../../../../../../../shared/badge-template-render";
import {
  eventSettingsUpdateSchema,
  eventManagementDetailResponseSchema,
} from "../../../../../../../shared/schemas/event-management";
import {
  groupEventDetailResponseSchema,
  groupEventSettingsUpdateSchema,
} from "../../../../../../../shared/schemas/group-events";
import { badgePrintingResponseSchema } from "../../../../../../../shared/schemas/route-contracts-event-badges";
import type {
  BadgeTemplateSponsorGroup,
  EventBadgeTemplate,
} from "../../../../../../../shared/schemas/event-badge-template";
import { useData } from "../../../../../../hooks/useData";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { getJson, patchJson } from "../../../../../../shared/api-client";
import { downloadBadgeArtifact } from "../../../../../../components/event-badges/badge-print-artifacts";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";
import { PageHeader } from "../../../../../../ui/PageHeader";
import { Button } from "../../../../../../ui/Button";
import { Field } from "../../../../../../ui/Field";
import { FileInput } from "../../../../../../ui/FileInput";
import { Textarea } from "../../../../../../ui/TextControl";
import { TabList } from "../../../../../../ui/TabList";

import { isAuthed, portalSession } from "../../../../state";
import { useSessionExpiry } from "../../../../use-session-expiry";
import type { PortalSession } from "../../../../types";

export function BadgeTemplateEditor(props: { slug: string; groupId?: string; eventId?: string; onBack: () => void }) {
  useSessionExpiry();
  const session = portalSession.value;
  if (!isAuthed.value || !session) return <ErrorAlert error="Sign in again to edit the badge design." />;
  return (
    <SessionTemplateEditor
      key={`${session.sessionId}:${session.identity.id}:${props.slug}`}
      {...props}
      session={session}
    />
  );
}

function SessionTemplateEditor({
  slug,
  groupId,
  eventId,
  onBack,
  session,
}: {
  session: PortalSession;
  slug: string;
  groupId?: string;
  eventId?: string;
  onBack: () => void;
}) {
  const endpoint =
    groupId && eventId
      ? `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(eventId)}`
      : `/api/v1/events/${encodeURIComponent(slug)}`;
  const data = useData(async () => {
    const [resource, printing] = await Promise.all([
      groupId && eventId
        ? getJson(endpoint, groupEventDetailResponseSchema)
        : getJson(endpoint, eventManagementDetailResponseSchema),
      getJson(`/api/v1/events/${encodeURIComponent(slug)}/badges/printing`, badgePrintingResponseSchema),
    ]);
    return { expectedUpdatedAt: resource.event.updatedAt, template: printing.template, branding: printing.branding };
  }, [endpoint, slug]);
  if (data.loading) return <Spinner label="Loading badge design…" />;
  if (!data.data) return <ErrorAlert error={data.error ?? "Badge design unavailable."} />;
  return (
    <DesignForm
      key={`${endpoint}:${data.data.expectedUpdatedAt}`}
      endpoint={endpoint}
      grouped={Boolean(groupId && eventId)}
      initial={data.data.template}
      branding={data.data.branding}
      session={session}
      expectedUpdatedAt={data.data.expectedUpdatedAt}
      onBack={onBack}
    />
  );
}

function DesignForm({
  endpoint,
  grouped,
  initial,
  branding,
  session,
  expectedUpdatedAt,
  onBack,
}: {
  endpoint: string;
  grouped: boolean;
  initial: EventBadgeTemplate | null;
  branding: BadgeTemplateSponsorGroup[];
  session: PortalSession;
  expectedUpdatedAt: string;
  onBack: () => void;
}) {
  const active = useRef(true);
  useEffect(
    () => () => {
      active.current = false;
    },
    [],
  );
  const current = () =>
    active.current &&
    isAuthed.value &&
    portalSession.value === session &&
    Math.min(Date.parse(session.expiresAt), Date.parse(session.idleExpiresAt)) > Date.now();
  const [html, setHtml] = useState(() => (initial ? exportBadgeTemplateHtml(initial) : ""));
  const [template, setTemplate] = useState(initial);
  const [revision, setRevision] = useState(expectedUpdatedAt);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState("front");
  const form = useContractForm(eventSettingsUpdateSchema, { expectedUpdatedAt: revision, badgeTemplate: template });
  function parse() {
    const next = importBadgeTemplateHtml(html);
    setTemplate(next);
    setSaved(false);
    return next;
  }
  async function save(event: Event) {
    event.preventDefault();
    setError("");
    try {
      if (!current()) throw new Error("Sign in again to save this badge design.");
      const next = parse();
      const checked = form.submit();
      if (!checked.data) {
        setError(checked.message);
        return;
      }
      const body = eventSettingsUpdateSchema.parse({ ...checked.data, badgeTemplate: next });
      setBusy(true);
      const response = grouped
        ? await patchJson(
            `${endpoint}/settings`,
            groupEventSettingsUpdateSchema.parse(body),
            groupEventDetailResponseSchema,
          )
        : await patchJson(`${endpoint}/settings`, body, eventManagementDetailResponseSchema);
      if (!current()) return;
      setRevision(response.event.updatedAt);
      setSaved(true);
    } catch (cause) {
      if (current()) setError(form.refuse(cause));
    } finally {
      if (current()) setBusy(false);
    }
  }
  const compiled = template ? compileBadgeTemplate(template, branding) : null;
  const preview = compiled
    ? `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${BADGE_PRINT_CONTENT_SECURITY_POLICY}"><style>body{margin:0}${compiled.css}</style></head><body>${compiled.resourcesHtml}${compiled.renderSide(view === "back" ? "back" : "front", { displayName: "Name preview", organization: "Organization preview", badgeRole: "attendee", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="1" y="1" width="98" height="98" fill="none" stroke="black"/><text x="10" y="50">QR position</text></svg>' })}</body></html>`
    : "";
  const previewDocument = badgePrintPreviewDocument(preview);
  return (
    <div class="pk-stack">
      <PageHeader title="Badge design" actions={<Button onClick={onBack}>Back to badges</Button>} />
      <p>
        Upload or edit this event’s self-contained HTML design. Front and back artwork, embedded fonts and SVG images
        stay in the reusable template. Names and access codes are filled only when preparing authorized badges.
      </p>
      <form noValidate {...form.handlers} onSubmit={save}>
        <Field
          label="HTML template"
          help="A self-contained HTML file with front and back badge sections. Scripts, external resources and active content are not accepted."
        >
          {(control) => (
            <FileInput
              {...control}
              accept=".html,text/html"
              disabled={busy}
              onFileChange={(file) => {
                if (!file) return;
                setError("");
                void file
                  .text()
                  .then((source) => {
                    if (!current()) return;
                    const parsed = importBadgeTemplateHtml(source);
                    setHtml(exportBadgeTemplateHtml(parsed));
                    setTemplate(parsed);
                    setSaved(false);
                  })
                  .catch((cause) =>
                    setError(cause instanceof Error ? cause.message : "Could not import this HTML template."),
                  );
              }}
            />
          )}
        </Field>
        <Field
          label="Editable HTML"
          help="Keep the {{qr}} slot and attendee text placeholders. SVG artwork and embedded fonts are preserved."
          {...form.of("badgeTemplate")}
        >
          {(control) => (
            <Textarea
              {...control}
              value={html}
              rows={12}
              disabled={busy}
              onInput={(event) => {
                setHtml(event.currentTarget.value);
                setSaved(false);
              }}
            />
          )}
        </Field>
        {error && <ErrorAlert error={error} />}
        {saved && <p role="status">Badge design saved for this event.</p>}
        <div class="pk-cluster">
          <Button type="submit" loading={busy}>
            Save badge design
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              try {
                setError("");
                parse();
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Check the HTML template.");
              }
            }}
          >
            Preview changes
          </Button>
          <Button
            type="button"
            disabled={busy || !template}
            onClick={() => {
              try {
                const next = parse();
                downloadBadgeArtifact(
                  exportBadgeTemplateHtml(next),
                  "text/html;charset=utf-8",
                  "badge-design-template.html",
                );
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Check the HTML template.");
              }
            }}
          >
            Download editable HTML template
          </Button>
        </div>
      </form>
      {compiled && (
        <>
          <TabList
            label="Badge design sides"
            items={[
              { id: "front", label: "Front" },
              { id: "back", label: "Back" },
            ]}
            activeId={view}
            onSelect={setView}
          />
          <p>
            Design preview uses placeholder names and a QR position marker. It is not a printable attendee credential.
          </p>
          <iframe
            class="pk-badge-print-preview"
            title="Badge design preview"
            sandbox="allow-same-origin"
            srcDoc={previewDocument.html}
            onLoad={async (event) => {
              try {
                await applyBadgePrintPreviewStyles(event.currentTarget, previewDocument.css);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Could not display the design preview.");
              }
            }}
          />
        </>
      )}
    </div>
  );
}
