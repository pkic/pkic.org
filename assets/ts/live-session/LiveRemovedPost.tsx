import type { ComponentChildren } from "preact";
import { liveModerationReasonLabel } from "../../shared/live-moderation-policy";
import type { LiveRemoval } from "../../shared/schemas/live-session-moderation";
import "./LiveRemovedPost.css";

/** Who hid a post and why; the author sees "a moderator", never a name. */
export function liveRemovalNote(removal: LiveRemoval): string {
  return `Hidden by ${removal.byName ?? "a moderator"}: ${liveModerationReasonLabel(removal.reason)}.`;
}

/**
 * A hidden post in place of its words, for the author and moderators: one quiet line on who hid it
 * and why, with the original words one click away.
 */
export function LiveRemovedPost({ note, children }: { note: string; children: ComponentChildren }) {
  return (
    <details class="pk-live-removed">
      <summary>
        <span class="pk-live-removed__note">{note}</span>
        <span class="pk-live-removed__toggle" data-when="closed">
          Show text
        </span>
        <span class="pk-live-removed__toggle" data-when="open">
          Hide text
        </span>
      </summary>
      <div class="pk-live-removed__words">{children}</div>
    </details>
  );
}
