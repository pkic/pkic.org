import { formatNumber } from "../../shared/format-number";
import type { OverlayRect } from "../../shared/live-overlay-geometry";
import type { LiveChatFeedOnAir, LiveTopQuestionsOnAir } from "../../shared/schemas/live-session-on-screen";
import { useNumericCssProperties } from "../hooks/useNumericCssProperties";
import { Avatar } from "../ui/Avatar";
import { LiveBoard } from "./LiveBoard";
import "./LiveAudienceListsOverlay.css";
import { LiveScreenText } from "./LiveScreenText";

/**
 * The audience lists on the conference board: the top questions and the
 * latest chat. Each takes its layout box's shape like every board, and steps
 * its type down as the list grows, so five questions or six messages still
 * fit. The room fills them; an output draws a list only while it holds
 * something.
 */

type Box = Pick<OverlayRect, "width" | "height">;

/** One question with its votes, and a bar of its votes against the leading question's. */
function TopQuestion({ question, lead }: { question: LiveTopQuestionsOnAir["questions"][number]; lead: number }) {
  const share = useNumericCssProperties({ "--share": lead > 0 ? question.votes / lead : 0 });
  return (
    <li class="pk-live-lists__question">
      <p class="pk-live-lists__votes">
        <span class="pk-live-lists__votes-count">{formatNumber(question.votes)}</span>
        <span class="pk-live-lists__votes-label">{question.votes === 1 ? "vote" : "votes"}</span>
      </p>
      <div class="pk-live-lists__body">
        <p class="pk-live-lists__text">
          <LiveScreenText text={question.text} />
        </p>
        {question.authorName ? <p class="pk-live-lists__byline">{question.authorName}</p> : null}
        <span class="pk-live-lists__share" data-numeric-css-properties={share} />
      </div>
    </li>
  );
}

/** The open questions with the most votes, most first. */
export function LiveTopQuestionsOverlay({ list, box }: { list: LiveTopQuestionsOnAir; box: Box }) {
  const lead = Math.max(0, ...list.questions.map((question) => question.votes));
  return (
    <LiveBoard box={box} class="pk-live-lists" label="Top questions" eyebrow="Top questions">
      <ol class="pk-live-lists__items" data-list="questions" data-count={list.questions.length}>
        {list.questions.map((question) => (
          <TopQuestion key={question.id} question={question} lead={lead} />
        ))}
      </ol>
    </LiveBoard>
  );
}

/** The latest attendee messages, newest at the bottom as in the chat itself. */
export function LiveChatFeedOverlay({ list, box }: { list: LiveChatFeedOnAir; box: Box }) {
  return (
    <LiveBoard box={box} class="pk-live-lists" label="Live chat" eyebrow="Live chat">
      <ol class="pk-live-lists__items" data-list="chat" data-count={list.messages.length}>
        {list.messages.map((message) => (
          <li key={message.id} class="pk-live-lists__message">
            <Avatar class="pk-live-lists__author" name={message.authorName} size="lg" />
            <div class="pk-live-lists__body">
              <p class="pk-live-lists__byline">{message.authorName}</p>
              <p class="pk-live-lists__text">{message.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </LiveBoard>
  );
}
