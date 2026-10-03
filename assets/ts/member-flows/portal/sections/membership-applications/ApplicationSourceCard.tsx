import "./ApplicationSourceCard.css";
import type { MembershipApplicationDetail } from "../../../../../shared/schemas/membership-application-management";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { Alert } from "../../../../ui/Alert";
import { fmt } from "../../ui";

/** Render source text literally: private attachment URLs must never load as remote images. */
export function ApplicationSourceCard({ source }: { source: NonNullable<MembershipApplicationDetail["source"]> }) {
  return (
    <Panel aria-label="Original application and source timeline">
      <PanelHeader title="Original application and source timeline" />
      <PanelBody class="pk-stack">
        <p>
          <a href={source.issueUrl} target="_blank" rel="noopener noreferrer">
            {source.repository} #{source.issueNumber}
          </a>{" "}
          · Imported {fmt(source.importedAt)}
        </p>
        {!source.historical && !source.activatedAt && (
          <Alert tone="warn">
            Processing is paused until source evidence, review timing, and portal ownership are reconciled. Importing
            sends no notices.
          </Alert>
        )}
        <h3>{source.snapshot.title}</h3>
        <pre class="pk-application-source-text">{source.snapshot.body || "No application text was recorded."}</pre>
        <details>
          <summary>Source discussion and timeline ({source.snapshot.events.length})</summary>
          <ol>
            {source.snapshot.events.map((event) => (
              <li key={`${event.kind}-${event.id}`}>
                <strong>{event.kind}</strong> · {event.author ?? "Unknown author"} · {fmt(event.createdAt)}
                {event.body && <pre class="pk-application-source-text">{event.body}</pre>}
              </li>
            ))}
          </ol>
        </details>
        {source.snapshot.attachmentUrls.length > 0 && (
          <p>Attachments remain in the original private GitHub issue. Open the source issue to access them.</p>
        )}
        {source.historical && <p>Historical evidence is read-only. Missing answers and consent remain unknown.</p>}
      </PanelBody>
    </Panel>
  );
}
