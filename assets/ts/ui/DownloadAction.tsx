/**
 * DownloadAction — the one control for exporting or downloading a file.
 *
 * Every export reads the same wherever it appears: the download glyph, never
 * a text button. The accessible name and tooltip state exactly what downloads,
 * including its format, such as "Download session demand (CSV)".
 *
 *   - One file is an icon-only secondary control. A file with a URL is a link,
 *     so it can be opened in a new tab or copied like any other address; a file
 *     the page generates is a button that is busy while it is being built.
 *   - Several formats or scopes are a split button: the glyph downloads the
 *     first option and the caret lists every option.
 */

import { useState } from "preact/hooks";

import type { MenuItem } from "./Menu";
import { Button, ButtonLink, type ButtonSize } from "./Button";
import { IconDownload } from "./MediaIcons";
import { SplitButton } from "./SplitButton";

/** Where the file comes from: a URL, or a page-generated file. */
export type DownloadSource =
  | {
      href: string;
      /** Sets the `download` attribute; a string also suggests the file name. */
      filename?: string | true;
      onDownload?: never;
    }
  | {
      /** Builds and saves the file. A returned promise keeps the control busy until it settles. */
      onDownload: () => void | Promise<unknown>;
      href?: never;
      filename?: never;
    };

/** One format or scope offered by a multi-option download. */
export type DownloadOption = { id: string; label: string; disabled?: boolean } & (
  { href: string; onDownload?: never } | { onDownload: () => void | Promise<unknown>; href?: never }
);

interface DownloadActionBase {
  /** States exactly what downloads, e.g. "Download session demand (CSV)". */
  label: string;
  disabled?: boolean;
  /** Busy from the caller's own work, in addition to a pending `onDownload`. */
  busy?: boolean;
}

export type DownloadActionProps = DownloadActionBase &
  (
    | (DownloadSource & { size?: ButtonSize; options?: never; menuLabel?: never })
    | {
        /** The first option is the direct download; the menu lists all of them. */
        options: readonly [DownloadOption, ...DownloadOption[]];
        /** Accessible name for the caret that opens the options. */
        menuLabel: string;
        size?: never;
        href?: never;
        filename?: never;
        onDownload?: never;
      }
  );

export function DownloadAction(props: DownloadActionProps) {
  const [pending, setPending] = useState(false);
  const busy = Boolean(props.busy) || pending;

  async function run(onDownload: () => void | Promise<unknown>) {
    const result = onDownload();
    if (!(result instanceof Promise)) return;
    setPending(true);
    try {
      await result;
    } finally {
      setPending(false);
    }
  }

  if (props.options) {
    const [first] = props.options;
    const items: MenuItem[] = props.options.map((option) =>
      option.href !== undefined
        ? { id: option.id, label: option.label, href: option.href, disabled: option.disabled }
        : {
            id: option.id,
            label: option.label,
            disabled: option.disabled || busy || props.disabled,
            onSelect: () => void run(option.onDownload),
          },
    );
    return (
      <SplitButton
        label={props.menuLabel}
        icon={<IconDownload />}
        variant="secondary"
        items={items}
        defaultAction={
          first.href !== undefined
            ? { label: props.label, href: first.href }
            : {
                label: props.label,
                onSelect: () => void run(first.onDownload),
                disabled: first.disabled || props.disabled,
                loading: busy,
              }
        }
      />
    );
  }

  if (props.href !== undefined && !props.disabled) {
    return (
      <ButtonLink
        variant="secondary"
        size={props.size}
        icon
        href={props.href}
        // `true` would become the literal file name "true" through the DOM property.
        download={props.filename === true ? "" : props.filename}
        aria-label={props.label}
        title={props.label}
      >
        <IconDownload />
      </ButtonLink>
    );
  }

  // A link cannot be disabled, so an unavailable file is a disabled button.
  const { onDownload } = props;
  return (
    <Button
      variant="secondary"
      size={props.size}
      icon
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      loading={busy}
      onClick={onDownload ? () => void run(onDownload) : undefined}
    >
      {!busy && <IconDownload />}
    </Button>
  );
}
