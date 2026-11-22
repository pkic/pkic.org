import type { LiveChatReplyQuote } from "../../shared/schemas/live-session-chat";

/**
 * The one line a reply opens with: who wrote the message it answers and its first words, or that the
 * message is gone. Where the feed can lead to the message, the line does.
 */
export function LiveChatQuote({ quote, onJump }: { quote: LiveChatReplyQuote; onJump?: (messageId: string) => void }) {
  if (quote.authorName === null || quote.excerpt === null)
    return (
      <p class="pk-live-chat__quote" data-removed="">
        Message removed
      </p>
    );
  const words = (
    <>
      <span class="pk-live-chat__quote-author">{quote.authorName}</span> {quote.excerpt}
    </>
  );
  return onJump ? (
    <button
      type="button"
      class="pk-live-chat__quote"
      aria-label={`Go to the message from ${quote.authorName}: ${quote.excerpt}`}
      onClick={() => onJump(quote.messageId)}
    >
      {words}
    </button>
  ) : (
    <p class="pk-live-chat__quote">{words}</p>
  );
}
