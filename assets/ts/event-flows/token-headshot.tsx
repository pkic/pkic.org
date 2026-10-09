/**
 * The photo on a token-bound page — a registration, or a speaker's own
 * self-service page — as the same tile the portal uses for a person.
 *
 * These pages are server-rendered markup driven by a module, not a Preact
 * application, so the tile is rendered into the section's mount point. They
 * mount no dialog host of their own either, and the tile confirms a removal
 * in the shared dialog, so the host is rendered beside it. The tile's outcome
 * is written to the section's own status line, which announces itself.
 */
import { render } from "preact";
import { useState } from "preact/hooks";
import { ConfirmDialogHost } from "../components/ConfirmDialog";
import { HeadshotTile } from "../shared/headshot/HeadshotTile";
import { headshotFormEndpoint } from "../shared/headshot/endpoints";
import { registrationHeadshotUploadResponseSchema } from "../../shared/schemas/registration";

export interface TokenHeadshotOptions {
  /** The `[data-headshot-section]` element holding `[data-headshot-tile]` and `[data-headshot-status]`. */
  section: HTMLElement | null;
  /** The pictured person's name, for the initials and the controls' names. */
  name: string;
  initialUrl: string | null | undefined;
  /** The token-bound headshot resource. */
  url: string;
  /** Said after a successful change, such as what else the photo updates. */
  successNote?: string;
  onChanged?: () => void;
}

function TokenHeadshot({ options, status }: { options: TokenHeadshotOptions; status: HTMLElement | null }) {
  const [imageUrl, setImageUrl] = useState(options.initialUrl ?? null);
  return (
    <>
      <HeadshotTile
        name={options.name}
        canChange
        imageUrl={imageUrl}
        consent="own"
        self
        // The token routes record the uploader's consent with the image.
        endpoint={headshotFormEndpoint(options.url, registrationHeadshotUploadResponseSchema, { consent: "true" })}
        onChanged={(next) => {
          setImageUrl(next);
          options.onChanged?.();
        }}
        notify={(message, type) => {
          if (!status) return;
          status.textContent =
            type === "success" && options.successNote ? `${message}. ${options.successNote}` : message;
          status.dataset.state = type === "error" ? "error" : "ok";
        }}
      />
      <ConfirmDialogHost />
    </>
  );
}

export function mountTokenHeadshot(options: TokenHeadshotOptions): void {
  const mount = options.section?.querySelector<HTMLElement>("[data-headshot-tile]");
  if (!mount) return;
  const status = options.section?.querySelector<HTMLElement>("[data-headshot-status]") ?? null;
  render(<TokenHeadshot options={options} status={status} />, mount);
}
