/**
 * HeadshotTile — a person's photo, and for editors the control that changes it.
 *
 * The tile is `PictureTile`, the same affordance an organization's logo uses:
 * the photo is the control ("Change photo" over it on hover or focus) and a
 * small corner button removes it. What a photograph of a person adds is the
 * pipeline before it is stored — the uploader asserts they may publish it,
 * and the image is cropped square because every surface draws it round — and
 * that pipeline is here once rather than at every place a face is edited.
 *
 * Where it is stored is the caller's: a `HeadshotEndpoint` for the signed-in
 * user, a person's record, a proposal speaker, or a token-bound registration.
 */
import { useRef } from "preact/hooks";
import { ApiClientError } from "../api-client";
import { friendlyErrorMessage } from "../../components/ErrorAlert";
import { PictureTile } from "../../components/PictureTile";
import type { PictureNotifier } from "../../components/usePictureCommands";
import type { AvatarStatus } from "../../ui/Avatar";
import { cropHeadshot } from "./crop";
import type { HeadshotEndpoint } from "./endpoints";
import { ADMIN_HEADSHOT_DISCLAIMER, OWN_HEADSHOT_DISCLAIMER, showHeadshotDisclaimer } from "./upload";

/** Larger originals are refused before they are decoded for the crop. */
const MAX_SOURCE_MB = 20;

export interface HeadshotTileProps {
  /** Whose photo this is: the initials, the image's name, and the controls' names. */
  name: string;
  imageUrl: string | null;
  canChange: boolean;
  endpoint: HeadshotEndpoint;
  /**
   * Who is asserting the right to publish: the person pictured (`own`) or
   * somebody acting for them (`on-behalf`). The two disclaimers say different
   * things, and asking a person to confirm they hold a license to their own
   * face reads as an error.
   */
  consent: "own" | "on-behalf";
  /** Whether the reader is the person pictured, which is how the removal question addresses them. */
  self?: boolean;
  status?: AvatarStatus;
  size?: "default" | "mark";
  /** Receives the stored picture's URL after an upload when the server reports one, and `null` after a removal. */
  onChanged: (headshotUrl: string | null) => void | Promise<void>;
  notify: PictureNotifier;
}

/** A transport status is not something a reader can act on; the shared translation turns it back into a sentence. */
function readable(cause: unknown, fallback: string): Error {
  return new Error(cause instanceof ApiClientError ? friendlyErrorMessage(cause.message) : fallback, { cause });
}

export function HeadshotTile(props: HeadshotTileProps) {
  // What the picture became, handed to `onChanged` once the tile has announced it.
  const changedTo = useRef<string | null>(props.imageUrl);

  return (
    <PictureTile
      status={props.status}
      name={props.name}
      noun="photo"
      shape="round"
      size={props.size ?? "mark"}
      canChange={props.canChange}
      imageUrl={props.imageUrl}
      alt={`${props.name}'s photo`}
      hint="JPEG, PNG or WebP."
      removeConfirmation={props.self ? "Remove your photo?" : `Remove ${props.name}'s photo?`}
      onUpload={async (file) => {
        if (file.size > MAX_SOURCE_MB * 1024 * 1024)
          throw new Error(`Please choose an image under ${MAX_SOURCE_MB} MB.`);
        /*
         * Publishing somebody's likeness is asserted before it is stored, not
         * after. Declining is an answer, so it returns `false` and the tile
         * reports neither success nor failure.
         */
        const accepted = await showHeadshotDisclaimer({
          title: "Before uploading a photo",
          texts: props.consent === "own" ? OWN_HEADSHOT_DISCLAIMER : ADMIN_HEADSHOT_DISCLAIMER,
          confirmText: "Proceed",
        });
        if (!accepted) return false;
        const cropped = await cropHeadshot(file);
        if (!cropped) return false;
        try {
          changedTo.current = (await props.endpoint.upload(cropped)) ?? props.imageUrl;
        } catch (cause) {
          throw readable(cause, "Could not upload the photo.");
        }
        return true;
      }}
      onRemove={async () => {
        try {
          await props.endpoint.remove();
          changedTo.current = null;
        } catch (cause) {
          throw readable(cause, "Could not remove the photo.");
        }
      }}
      onChanged={() => void props.onChanged(changedTo.current)}
      toast={props.notify}
    />
  );
}
