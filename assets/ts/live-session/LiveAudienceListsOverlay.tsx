import type { ComponentChildren } from "preact";
import { formatNumber } from "../../shared/format-number";
import type { LiveChatFeedOnAir, LiveTopQuestionsOnAir } from "../../shared/schemas/live-session-on-screen";
import { OverlayEmblem } from "./LiveEmblem";
import "./LiveAudienceListsOverlay.css";

/**
 * The audience lists on an output, each a card of one fixed width so a
 * layout box scales every list alike however many lines it holds. The room
 * fills them; the output draws a list only while it holds something.
 */

function ListCard({
  title,
  kind,
  children,
}: {
  title: string;
  kind: "questions" | "chat";
  children: ComponentChildren;
}) {
  return (
    <section class="pk-live-overlay__list" data-list={kind} aria-label={title}>
      <header class="pk-live-overlay__list-header">
        <OverlayEmblem />
        <p class="pk-live-overlay__list-title">{title}</p>
      </header>
      {children}
    </section>
  );
}

/** The open questions with the most votes, most first. */
export function LiveTopQuestionsOverlay({ list }: { list: LiveTopQuestionsOnAir }) {
  return (
    <ListCard title="Top questions" kind="questions">
      <ol class="pk-live-overlay__list-items">
        {list.questions.map((question) => (
          <li key={question.id} class="pk-live-overlay__list-item">
            <p class="pk-live-overlay__votes">
              <span class="pk-live-overlay__votes-count">{formatNumber(question.votes)}</span>
              <span class="pk-live-overlay__votes-label">{question.votes === 1 ? "vote" : "votes"}</span>
            </p>
            <div class="pk-live-overlay__list-body">
              <p class="pk-live-overlay__list-text">{question.text}</p>
              <p class="pk-live-overlay__list-byline">{question.authorName ?? "Audience question"}</p>
            </div>
          </li>
        ))}
      </ol>
    </ListCard>
  );
}

/** The latest attendee messages, newest at the bottom as in the chat itself. */
export function LiveChatFeedOverlay({ list }: { list: LiveChatFeedOnAir }) {
  return (
    <ListCard title="Chat" kind="chat">
      <ol class="pk-live-overlay__list-items">
        {list.messages.map((message) => (
          <li key={message.id} class="pk-live-overlay__list-item">
            <div class="pk-live-overlay__list-body">
              <p class="pk-live-overlay__list-byline">{message.authorName}</p>
              <p class="pk-live-overlay__list-text">{message.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </ListCard>
  );
}
