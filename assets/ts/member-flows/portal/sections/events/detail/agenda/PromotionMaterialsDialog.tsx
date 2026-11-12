import { Suspense } from "preact/compat";
import { useRef, useState } from "preact/hooks";
import { Spinner } from "../../../../../../components/Spinner";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { MAX_PROMOTION_MATERIAL_FILES } from "../../../../../../../shared/schemas/event-email-campaigns";
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
  const [notice, setNotice] = useState("");
  const downloads = useRef(new Map<string, () => Promise<void>>());

  const pick: PromotionFilePicker = (key, download) => {
    if (download) downloads.current.set(key, download);
    else downloads.current.delete(key);
    return {
      checked: selected.has(key),
      onChange: (checked) => {
        setNotice("");
        setSelected((current) => {
          const next = new Set(current);
          if (checked) next.add(key);
          else next.delete(key);
          return next;
        });
      },
    };
  };

  async function downloadSelected() {
    // A tile registers its download only while its file is ready; never skip a picked file silently.
    if ([...selected].some((key) => !downloads.current.has(key))) {
      setNotice("Some files are not ready yet. Try again in a moment.");
      return;
    }
    setNotice("");
    setDownloading(true);
    try {
      for (const key of selected) await downloads.current.get(key)!();
    } finally {
      setDownloading(false);
    }
  }

  const tooMany = selected.size > MAX_PROMOTION_MATERIAL_FILES;

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
            {notice ||
              (tooMany
                ? `${selected.size} selected. Email up to ${MAX_PROMOTION_MATERIAL_FILES} files at a time.`
                : selected.size
                  ? `${selected.size} selected`
                  : "Select the files to download or email")}
          </span>
          <Button disabled={!selected.size} loading={downloading} onClick={() => void downloadSelected()}>
            Download selected
          </Button>
          <Button variant="primary" disabled={!selected.size || tooMany} onClick={() => onEmail([...selected])}>
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
