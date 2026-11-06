import { CollectionCardFooter, CollectionCardSurface } from "../../../../../../ui/CollectionCard";
import { Button } from "../../../../../../ui/Button";
import { Dialog } from "../../../../../../ui/Dialog";
import { useDialogQueryState } from "../../../../../../hooks/useDialogQueryState";
import { useEffect, useRef, useState } from "preact/hooks";
import { ImageCarousel, ImageCarouselControls } from "../../../../../../ui/ImageCarousel";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import type { ComponentChildren } from "preact";
import "./PromotionGallery.css";

/**
 * One ready-to-post picture in a promotion gallery: a small preview, what it is
 * for, and its download. The preview frame keeps one height for every format,
 * so a tall story and a wide post line up in the same row.
 */
export function PromotionTile({
  name,
  detail,
  previewSrc,
  previewId,
  previewAlt,
  pending,
  stacked,
  status,
  action,
  previewActions,
  loadSlides,
}: {
  name: string;
  detail: string;
  previewSrc?: string;
  previewId?: string;
  previewAlt: string;
  /** Shown in the frame while the picture is not ready. */
  pending?: string;
  /** Draws the preview as the first of several slides. */
  stacked?: boolean;
  status?: string;
  action?: ComponentChildren;
  loadSlides?: (signal: AbortSignal) => Promise<string[]>;
  previewActions?: (dismiss: () => Promise<void>) => ComponentChildren;
}) {
  const [open, show, close] = useDialogQueryState(`promotionPreview:${previewId ?? name}`);
  const [slides, setSlides] = useState<string[] | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideError, setSlideError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const loader = useRef(loadSlides);
  loader.current = loadSlides;
  const hasSlides = Boolean(loadSlides);
  useEffect(() => {
    if (!open) {
      setSlideIndex(0);
      return;
    }
    if (!hasSlides || slides) return;
    const controller = new AbortController();
    setSlideError("");
    void loader.current!(controller.signal)
      .then((sources) => {
        if (!controller.signal.aborted) setSlides(sources);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setSlideError(error instanceof Error ? error.message : "Could not load the slides.");
      });
    return () => controller.abort();
  }, [open, hasSlides, slides, attempt]);
  const moveSlide = (direction: -1 | 1) => {
    const element = viewport.current;
    element?.scrollBy({ left: element.clientWidth * direction });
  };
  return (
    <li class="pk-promotion-tile">
      <CollectionCardSurface>
        {previewSrc ? (
          <Button
            variant="ghost"
            class={`pk-promotion-tile__frame${stacked ? " pk-promotion-tile__frame--stacked" : ""}`}
            aria-label={`Enlarge ${name.toLowerCase()}`}
            title={`Enlarge ${name.toLowerCase()}`}
            onClick={show}
          >
            <img src={previewSrc} alt={previewAlt} loading="lazy" decoding="async" />
          </Button>
        ) : (
          <div class="pk-promotion-tile__frame">
            <span class="pk-promotion-tile__pending">{pending}</span>
          </div>
        )}
        {previewSrc && open && (
          <Dialog
            open={open}
            viewer
            size="wide"
            title={name}
            closeLabel="Close preview"
            footerActions={
              <>
                {slides && slides.length > 1 && (
                  <ImageCarouselControls index={slideIndex} count={slides.length} onMove={moveSlide} />
                )}
                {previewActions?.(close) ?? action}
              </>
            }
            confirmLabel="Close"
            onConfirm={() => void close()}
            onCancel={() => void close()}
          >
            {loadSlides ? (
              <>
                {slideError ? (
                  <>
                    <ErrorAlert error={slideError} />
                    <Button onClick={() => setAttempt((value) => value + 1)}>Retry loading slides</Button>
                  </>
                ) : (
                  !slides && <p role="status">Loading slides…</p>
                )}
                <ImageCarousel
                  sources={slides ?? [previewSrc]}
                  label={name}
                  viewportRef={viewport}
                  onIndexChange={setSlideIndex}
                />
              </>
            ) : (
              <img class="pk-promotion-preview" src={previewSrc} alt={previewAlt} />
            )}
          </Dialog>
        )}
        <CollectionCardFooter
          fact={
            <span class="pk-promotion-tile__text">
              <span class="pk-promotion-tile__name">{name}</span>
              <span class="pk-promotion-tile__detail">{detail}</span>
              <span role="status">{status}</span>
            </span>
          }
          actions={action}
        />
      </CollectionCardSurface>
    </li>
  );
}
