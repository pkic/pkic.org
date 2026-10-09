/**
 * The commands every picture tile shares, whatever the picture is: upload
 * with an announced outcome either way, remove behind a confirmation, and a
 * mount key that resets the file control after every attempt.
 *
 * Callers own their API client, their endpoint, and their notifier.
 */
import { useState } from "preact/hooks";
import { confirmAction } from "./ConfirmDialog";

export type PictureNotifier = (message: string, type: "success" | "error") => void;

export interface PictureCommandOptions {
  /** What the picture is called, in the words the commands use: "photo", "logo". */
  noun: string;
  /** The question the removal confirmation asks. */
  removeConfirmation: string;
  /**
   * Stores the chosen file. A caller whose upload asks the reader something
   * first — the headshot disclaimer, a crop they can back out of — answers
   * `false` when the reader abandons it, which is neither success nor failure.
   */
  onUpload: (file: File) => Promise<unknown>;
  /** Absent when the picture cannot be removed from this surface. */
  onRemove?: () => Promise<unknown>;
  onChanged: () => void;
  toast: PictureNotifier;
  /** Replaces "Photo uploaded" where the upload does something else, such as entering review. */
  uploadedMessage?: string;
}

export function usePictureCommands(options: PictureCommandOptions) {
  // "Logo uploaded" is wrong over a person's face. The word comes from the
  // caller, capitalized for the start of the sentence it begins.
  const Noun = options.noun.charAt(0).toUpperCase() + options.noun.slice(1);
  const removeLabel = `Remove ${options.noun}`;
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  async function upload(file: File) {
    setBusy(true);
    try {
      const outcome = await options.onUpload(file);
      if (outcome === false) return;
      options.toast(options.uploadedMessage ?? `${Noun} uploaded`, "success");
      options.onChanged();
    } catch (error) {
      options.toast((error as Error).message, "error");
    } finally {
      setBusy(false);
      setAttempt((current) => current + 1);
    }
  }

  async function remove() {
    if (!options.onRemove) return;
    const confirmed = await confirmAction({
      title: options.removeConfirmation,
      confirmLabel: removeLabel,
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await options.onRemove();
      options.toast(`${Noun} removed`, "success");
      options.onChanged();
    } catch (error) {
      options.toast((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return { busy, attempt, upload, remove: options.onRemove ? remove : undefined, removeLabel };
}
