import { Suspense } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import { Spinner } from "../../../../../../components/Spinner";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { MyPromotionKits, type PromotionFilePicker } from "./MyPromotionKits";

/**
 * An organizer's view of one person's promotion materials: every file as a
 * card, and the commands that act on the cards they pick.
 */
export function PromotionMaterialsDialog({
  slug,
  userId,
  name,
  onClose,
  onEmail,
  initialSelected = [],
  emailLabel = "Email selected",
}: {
  slug: string;
  userId: string;
  name?: string;
  onClose: () => void;
  /** Opens a message to this person with the picked files attached, by their keys. */
  onEmail: (keys: string[]) => void;
  /** The file keys already picked, when the dialog reopens from a message. */
  initialSelected?: readonly string[];
  emailLabel?: string;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initialSelected));
  const [downloading, setDownloading] = useState(false);
  const downloads = useRef(new Map<string, () => Promise<void>>());

  const pick: PromotionFilePicker = (key, download) => {
    downloads.current.set(key, download);
    return {
      checked: selected.has(key),
      onChange: (checked) =>
        setSelected((current) => {
          const next = new Set(current);
          if (checked) next.add(key);
          else next.delete(key);
          return next;
        }),
    };
  };

  async function downloadSelected() {
    setDownloading(true);
    try {
      for (const key of selected) await downloads.current.get(key)?.();
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Dialog
      open
      viewer
      size="wide"
      title="Promotion materials"
      meta={name}
      closeLabel="Close promotion materials"
      confirmLabel="Close"
      onConfirm={onClose}
      onCancel={onClose}
      footerActions={
        <>
          <span class="pk-dialog__foot-status" role="status">
            {selected.size ? `${selected.size} selected` : "Select the files to download or email"}
          </span>
          <Button disabled={!selected.size} loading={downloading} onClick={() => void downloadSelected()}>
            Download selected
          </Button>
          <Button variant="primary" disabled={!selected.size} onClick={() => onEmail([...selected])}>
            {emailLabel}
          </Button>
        </>
      }
    >
      <Suspense fallback={<Spinner />}>
        <MyPromotionKits slug={slug} userId={userId} pick={pick} />
      </Suspense>
    </Dialog>
  );
}
