/**
 * A link the reader is meant to take away, with the control that copies it.
 *
 * The copy outcome is a `role="status"` line beside the button rather than a
 * relabelled button: changing a control's accessible name under the reader's
 * cursor moves the goalposts mid-interaction. The link stays visible in a
 * read-only field that selects itself on focus, which is the manual fallback
 * the failure message points to.
 */
import { useState } from "preact/hooks";

import { copyText } from "../clipboard";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { TextInput } from "../../ui/TextControl";

const COPIED = "Link copied to your clipboard.";
const FAILED = "Could not copy automatically — select the link above and copy it.";
const FAILED_COMPACT = "Could not copy automatically. Select the link below and copy it.";

/**
 * `compact` lists the link by its name alone, for a set of links such as a
 * room's outputs: the name, the copy control and its outcome on one line.
 * The link itself shows only when copying failed, as the manual fallback.
 */
export function CopyLinkRow({
  url,
  label,
  help,
  compact = false,
}: {
  url: string;
  label: string;
  help?: string;
  compact?: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const copy = () =>
    void copyText(url, {
      copied: COPIED,
      failed: compact ? FAILED_COMPACT : FAILED,
      notify: (message, tone) => {
        setCopyStatus(message);
        setFailed(tone === "error");
      },
    });
  const field = (
    <Field label={label} help={help}>
      {(control) => (
        <TextInput
          {...control}
          class="pk-mono"
          data-copy-link
          value={url}
          readOnly
          onFocus={(event) => event.currentTarget.select()}
        />
      )}
    </Field>
  );

  if (compact)
    return (
      <div class="pk-stack pk-stack--snug" data-copy-link-row>
        <div class="pk-cluster pk-cluster--between">
          <span>{label}</span>
          <div class="pk-cluster">
            <p class="pk-small" role="status">
              {copyStatus}
            </p>
            <Button data-copy-link-button aria-label={`Copy the ${label} link`} onClick={copy}>
              Copy link
            </Button>
          </div>
        </div>
        {failed ? field : null}
      </div>
    );

  return (
    <div class="pk-stack pk-stack--snug pk-start" data-copy-link-row>
      {field}
      <div class="pk-cluster">
        <Button data-copy-link-button onClick={copy}>
          Copy link
        </Button>
        <p class="pk-small" role="status">
          {copyStatus}
        </p>
      </div>
    </div>
  );
}
