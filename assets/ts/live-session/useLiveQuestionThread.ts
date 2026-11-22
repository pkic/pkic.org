import { useEffect, useRef } from "preact/hooks";
import type { LiveRoomClientMessage } from "../../shared/schemas/live-session-room";

/**
 * Follows one question's answers for as long as its thread is on screen. The
 * room delivers one thread per connection: watching another question replaces
 * it, leaving ends it, and a reconnect asks again, since the room forgot.
 */
export function useLiveQuestionThread(
  questionId: string | null,
  connected: boolean,
  send: (message: LiveRoomClientMessage) => boolean,
): void {
  // The thread follows the question, not the identity of the function that reaches the room.
  const room = useRef(send);
  room.current = send;
  useEffect(() => {
    if (!questionId || !connected) return;
    room.current({ type: "question.answers.watch", questionId });
    return () => {
      room.current({ type: "question.answers.watch", questionId: null });
    };
  }, [questionId, connected]);
}
