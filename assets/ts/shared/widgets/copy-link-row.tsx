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

export function CopyLinkRow({ url, label, help }: { url: string; label: string; help?: string }) {
  const [copyStatus, setCopyStatus] = useState("");

  return (
    <div class="pk-stack pk-stack--snug pk-start" data-copy-link-row>
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
      <div class="pk-cluster">
        <Button
          size="sm"
          data-copy-link-button
          onClick={() => void copyText(url, { copied: COPIED, failed: FAILED, notify: setCopyStatus })}
        >
          Copy link
        </Button>
        <p class="pk-small" role="status">
          {copyStatus}
        </p>
      </div>
    </div>
  );
}
