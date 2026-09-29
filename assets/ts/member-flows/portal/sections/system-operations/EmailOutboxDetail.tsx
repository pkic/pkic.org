import { DIRECT_EMAIL_TEMPLATE_KEY, emailOutboxDetailResponseSchema } from "../../../../../shared/schemas/email-outbox";
import { useData } from "../../../../hooks/useData";
import { getJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { PageHeader } from "../../../../ui/PageHeader";
import { Panel, PanelBody } from "../../../../ui/Panel";
import { Spinner } from "../../../../components/Spinner";
import { Badge } from "../../../../components/Badge";
import { fmt } from "../../ui";

function decodeOutboxRouteId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

export function EmailOutboxDetail({ id }: { id: string }) {
  const outboxId = decodeOutboxRouteId(id);
  const { data, error, loading } = useData(
    () => getJson(`/api/v1/email/outbox/${encodeURIComponent(outboxId)}`, emailOutboxDetailResponseSchema),
    [outboxId],
  );
  const message = data?.message;
  return (
    <div class="pk pk-stack">
      <PageHeader
        title={message?.subject || "Email delivery details"}
        trail={[
          { label: "Settings", href: "#/settings" },
          { label: "Email outbox", href: "#/settings/email-outbox" },
          { label: message?.subject || "Email delivery details" },
        ]}
      />
      {loading && <Spinner />}
      {error && <Alert tone="danger">{error}</Alert>}
      {message && (
        <Panel>
          <PanelBody class="pk-stack">
            {message.lastError && (
              <Alert tone="danger" title="Delivery failure">
                {message.lastError}
              </Alert>
            )}
            <DescriptionList
              items={[
                {
                  term: "Recipient",
                  value: message.recipientName
                    ? `${message.recipientName} <${message.recipientEmail}>`
                    : message.recipientEmail,
                },
                { term: "Status", value: <Badge status={message.status} /> },
                {
                  term: message.usesDirectBody ? "Source template" : "Template",
                  value:
                    message.templateKey === DIRECT_EMAIL_TEMPLATE_KEY
                      ? "None"
                      : `${message.templateKey}${message.templateVersion === null ? "" : ` v${message.templateVersion}`}`,
                },
                { term: "Event", value: message.eventName || "—" },
                { term: "Attempts", value: String(message.attempts) },
                { term: "Queued", value: fmt(message.createdAt) },
                { term: "Due", value: fmt(message.sendAfter) },
                { term: "Sent", value: fmt(message.sentAt) },
                { term: "Last updated", value: fmt(message.updatedAt) },
                { term: "Provider", value: message.provider },
                { term: "Provider message ID", value: message.providerMessageId || "—" },
                { term: "Message ID", value: message.id },
              ]}
            />
            {message.bodyContent !== null && (
              <section class="pk-stack pk-stack--tight" aria-label="Queued message">
                <h2>Queued message</h2>
                <p class="pk-small">
                  This message is stored in the outbox. Recipient variables are filled in when it is sent.
                </p>
                <pre class="pk-code-block pk-small pk-break">{message.bodyContent}</pre>
              </section>
            )}
            {message.bodyContent === null && message.customText !== null && (
              <section class="pk-stack pk-stack--tight" aria-label="Custom message text">
                <h2>Custom message text</h2>
                <p class="pk-small">
                  This text is stored with the outbox message and applied to the template when it is sent.
                </p>
                <pre class="pk-code-block pk-small pk-break">{message.customText}</pre>
              </section>
            )}
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
