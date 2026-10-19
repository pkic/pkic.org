import type { LiveTicker } from "../../shared/schemas/live-session-ticker";
import { renderOverlayInlineMarkdown } from "../../shared/overlay-text-template";
import "./LiveTickerOverlay.css";
/** One uninterrupted track: every label and message travels through the same loop. */
export function LiveTickerOverlay({ ticker }: { ticker: LiveTicker | null }) {
  if (!ticker?.segments.length) return null;
  return (
    <div class={`pk-live-ticker pk-live-ticker--${ticker.style}`} aria-label="News ticker">
      <div class="pk-live-ticker__window">
        <div class="pk-live-ticker__track">
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
