import type { RefObject } from "preact";
import { Button } from "./Button";
import { Toolbar } from "./Toolbar";
import { IconChevron } from "./MediaIcons";
import { formatNumber } from "../../shared/format-number";
import "./ImageCarousel.css";

/** Native horizontal scrolling supplies touch, trackpad, and scroll-snap navigation. */
export function ImageCarousel({
  sources,
  label,
  viewportRef,
  onIndexChange,
}: {
  sources: readonly string[];
  label: string;
  viewportRef: RefObject<HTMLDivElement>;
  onIndexChange: (index: number) => void;
}) {
  return (
    <div
      ref={viewportRef}
      class="pk-image-carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onScroll={(event) => {
        const viewport = event.currentTarget;
        if (viewport.clientWidth)
          onIndexChange(
            Math.max(0, Math.min(sources.length - 1, Math.round(viewport.scrollLeft / viewport.clientWidth))),
          );
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const viewport = event.currentTarget;
        viewport.scrollBy({ left: viewport.clientWidth * (event.key === "ArrowRight" ? 1 : -1) });
      }}
    >
      {sources.map((src, index) => (
        <div
          class="pk-image-carousel__slide"
          role="group"
          aria-roledescription="slide"
          aria-label={`${formatNumber(index + 1)} of ${formatNumber(sources.length)}`}
          key={src}
        >
          <img src={src} alt={`${label}, slide ${formatNumber(index + 1)}`} draggable={false} />
        </div>
      ))}
    </div>
  );
}

/** Place these controls in the containing viewer's shared footer. */
export function ImageCarouselControls({
  index,
  count,
  onMove,
}: {
  index: number;
  count: number;
  onMove: (direction: -1 | 1) => void;
}) {
  return (
    <Toolbar label="Slide navigation">
      <Button icon aria-label="Previous slide" title="Previous slide" disabled={index === 0} onClick={() => onMove(-1)}>
        <IconChevron pointing="left" />
      </Button>
      <span role="status" aria-live="polite">
        {formatNumber(index + 1)} of {formatNumber(count)}
      </span>
      <Button icon aria-label="Next slide" title="Next slide" disabled={index >= count - 1} onClick={() => onMove(1)}>
        <IconChevron pointing="right" />
      </Button>
    </Toolbar>
  );
}
