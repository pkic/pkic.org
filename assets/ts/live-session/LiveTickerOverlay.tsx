import { useLayoutEffect, useRef } from "preact/hooks";
import type { OverlayRect } from "../../shared/live-overlay-geometry";
import { LIVE_OVERLAY_FRAME } from "../../shared/schemas/live-overlay-layout";
import { LIVE_TICKER_SPEED, type LiveTicker } from "../../shared/schemas/live-session-ticker";
import { renderOverlayInlineMarkdown } from "../../shared/overlay-text-template";
import { useNumericCssProperties } from "../hooks/useNumericCssProperties";
import { liveBoardInset } from "./LiveBoard";
import "./LiveGraphicTheme.css";
import "./LiveTickerOverlay.css";

/** The broadcast title-safe margin at the frame's foot, in pixels of the frame. */
const TITLE_SAFE_FOOT = 54;

/**
 * The ticker's own geometry for its box: its width, the inset its text keeps
 * from the sides when it stands still (the boards' inset, so its words line up
 * with theirs; scrolling text runs the box's whole width) and,
 * when the box runs on to the frame's foot, the glass it extends below the
 * text so the text stays title-safe.
 */
export function liveTickerGeometry(box: Pick<OverlayRect, "x" | "y" | "width" | "height">) {
  const below = LIVE_OVERLAY_FRAME.height - box.y - box.height;
  return {
    width: Math.round(box.width),
    inset: liveBoardInset(box).inline,
    foot: Math.max(0, TITLE_SAFE_FOOT - Math.max(0, below)),
  };
}

/**
 * The width of one pass of the messages, on the track as `--pk-live-ticker-travel`, and the time that pass
 * takes at the ticker's speed, as `--pk-live-ticker-duration`: the ticker moves at the same pace whatever
 * the length of its messages. An output scrolls by half its own track and never reads the width; a small
 * picture of the output scrolls by this length instead, since it moves the track without a graphics layer
 * (see StudioPhone.css).
 */
function useTickerTravel(ticker: LiveTicker | null) {
  const track = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = track.current;
    const pass = node?.firstElementChild;
    if (!node || !(pass instanceof HTMLElement)) return;
    const pace = ticker?.speed ?? LIVE_TICKER_SPEED.default;
    const measure = () => {
      // Not laid out yet: the stylesheet's normal pace holds until it is.
      if (!pass.offsetWidth) return;
      node.style.setProperty("--pk-live-ticker-travel", `${pass.offsetWidth}px`);
      node.style.setProperty("--pk-live-ticker-duration", `${(pass.offsetWidth / pace).toFixed(2)}s`);
    };
    measure();
    // Fonts arriving late change the length of a pass.
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(pass);
    return () => observer.disconnect();
  }, [ticker?.segments, ticker?.speed]);
  return track;
}

/**
 * One uninterrupted track: every label and message travels through the same
 * loop, on a see-through bar as wide as its box, like the panels it sits with.
 */
export function LiveTickerOverlay({
  ticker,
  box,
}: {
  ticker: LiveTicker | null;
  box: Pick<OverlayRect, "x" | "y" | "width" | "height">;
}) {
  const track = useTickerTravel(ticker);
  const geometry = liveTickerGeometry(box);
  const bar = useNumericCssProperties({
    "--ticker-width": geometry.width,
    "--ticker-inset": geometry.inset,
    "--ticker-foot": geometry.foot,
  });
  if (!ticker?.segments.length) return null;
  return (
    <div
      class="pk-live-ticker"
      aria-label="News ticker"
      data-graphic-theme={ticker.theme}
      data-numeric-css-properties={bar}
    >
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
