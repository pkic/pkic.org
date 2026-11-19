import { useLayoutEffect, useRef } from "preact/hooks";
import type { LiveTicker } from "../../shared/schemas/live-session-ticker";
import { renderOverlayInlineMarkdown } from "../../shared/overlay-text-template";
import "./LiveTickerOverlay.css";

/**
 * The width of one pass of the messages, on the track as `--pk-live-ticker-travel`. An output scrolls by
 * half its own track and never reads it; a small picture of the output scrolls by this length instead,
 * since it moves the track without a graphics layer (see StudioPhone.css).
 */
function useTickerTravel(ticker: LiveTicker | null) {
  const track = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = track.current;
    const pass = node?.firstElementChild;
    if (!node || !(pass instanceof HTMLElement)) return;
    const measure = () => node.style.setProperty("--pk-live-ticker-travel", `${pass.offsetWidth}px`);
    measure();
    // Fonts arriving late change the length of a pass.
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(pass);
    return () => observer.disconnect();
  }, [ticker?.segments]);
  return track;
}

/** One uninterrupted track: every label and message travels through the same loop. */
export function LiveTickerOverlay({ ticker }: { ticker: LiveTicker | null }) {
  const track = useTickerTravel(ticker);
  if (!ticker?.segments.length) return null;
  return (
    <div class={`pk-live-ticker pk-live-ticker--${ticker.style}`} aria-label="News ticker">
      <div class="pk-live-ticker__window">
        <div class="pk-live-ticker__track" ref={track}>
          {[false, true].map((duplicate) => (
            <div class="pk-live-ticker__group" aria-hidden={duplicate ? "true" : undefined}>
              {ticker.segments.map((segment) => (
                <span key={segment.id} class="pk-live-ticker__repeat">
                  {segment.prefix ? <strong class="pk-live-ticker__label">{segment.prefix}</strong> : null}
                  <span
                    class="pk-live-ticker__message"
                    dangerouslySetInnerHTML={{ __html: renderOverlayInlineMarkdown(segment.markdown) }}
                  />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
