/**
 * The event app's answer threads and moderation, drawn through their own
 * components: an asker's thread with votes and the accepted answer, an
 * author's removed answer, a blocked attendee, and a moderator's Remove.
 */
import { useEffect } from "preact/hooks";
import type { LiveQuestionAnswer } from "../../../shared/schemas/live-session-answer";
import type { LiveQuestion } from "../../../shared/schemas/live-session-room";
import { LiveAuthorProvider } from "../../live-session/LiveAuthor";
import { askModerationReason, LiveModerationDialogHost } from "../../live-session/LiveModerationDialog";
import { LiveParticipationAlert } from "../../live-session/LiveParticipationAlert";
import { LiveQuestionList } from "../../live-session/LiveQuestionList";
import { LiveQuestionThread } from "../../live-session/LiveQuestionThread";
import type { LiveAnswerViewer } from "../../live-session/LiveQuestionAnswerRow";
import type { PreviewSection } from "./PreviewShell";

const send = () => true;
const ZONE = "America/New_York";
const AT = "2026-11-17T15:00:00.000Z";

const question = (overrides: Partial<LiveQuestion> = {}): LiveQuestion => ({
  id: "20000000-0000-4000-8000-0000000000a1",
  text: "How should we plan certificate lifetimes once 47-day TLS certificates are required?",
  status: "approved",
  votes: 24,
  anonymous: false,
  authorName: "Maria Jensen",
  authorPhotoUrl: null,
  mine: true,
  revision: 0,
  withdrawn: false,
  canEdit: false,
  votedByMe: false,
  askedAt: AT,
  answeredAt: null,
  moderated: null,
  originalText: null,
  rewritten: null,
  answerCount: 3,
  acceptedAnswer: true,
  removal: null,
  done: null,
  authorRestriction: null,
  addressedTo: null,
  prepared: false,
  ...overrides,
});

const answer = (id: string, overrides: Partial<LiveQuestionAnswer>): LiveQuestionAnswer => ({
  id: `30000000-0000-4000-8000-0000000000${id}`,
  text: "",
  authorName: "Sam Lee",
  mine: false,
  createdAt: AT,
  revision: 0,
  acceptance: null,
  votes: 0,
  votedByMe: false,
  removal: null,
  authorRestriction: null,
  authorStaff: false,
  ...overrides,
});

/** A thread with an accepted answer and votes, as the event app and the studio's open question both draw it. */
export const sampleLiveAnswers = [
  answer("b1", {
    authorName: "Alex Moreau",
    authorRoles: ["speaker"],
    text: "Automate renewal first. Track every issued certificate, then shorten lifetimes in steps.",
    votes: 9,
    acceptance: { byName: null, at: AT },
  }),
  answer("b2", {
    text: "We moved to 90 days last year. The inventory was the hard part, not the tooling.",
    votes: 5,
    votedByMe: true,
  }),
  answer("b3", { authorName: "Priya Shah", text: "The speaker covers this at the end of the session.", votes: 1 }),
];

function Thread({
  q,
  list,
  viewer = { role: "attendee" },
  rights,
  blocked = false,
}: {
  q: LiveQuestion;
  list: LiveQuestionAnswer[];
  viewer?: LiveAnswerViewer;
  rights: { canAnswer: boolean; canAccept: boolean; canVote: boolean; canModerate: boolean };
  blocked?: boolean;
}) {
  return (
    <LiveAuthorProvider authors={{}} send={send}>
      <div class="pk-stack">
        {blocked ? <LiveParticipationAlert restriction={{ block: "session", until: null }} timeZone={ZONE} /> : null}
        <LiveQuestionList
          photos
          questions={[q]}
          emptyText=""
          showStatus={() => false}
          onVote={() => undefined}
          thread={(row) => (
            <LiveQuestionThread
              question={row}
              expanded
              toggle={() => undefined}
              thread={{ type: "question.answers", questionId: row.id, answers: list, ...rights }}
              disabled={false}
              send={send}
              result={null}
              viewer={viewer}
              restriction={blocked ? { block: "session", until: null } : null}
              timeZone={ZONE}
            />
          )}
        />
      </div>
    </LiveAuthorProvider>
  );
}

function RemoveDialog() {
  useEffect(() => {
    void askModerationReason({
      title: "Remove this answer?",
      body: "It's hidden from everyone. The author still sees it, with the reason you choose.",
      confirmLabel: "Remove answer",
    });
  }, []);
  return <LiveModerationDialogHost />;
}

export const liveAnswerSections: PreviewSection[] = [
  {
    id: "live-answer-thread",
    title: "Event app: answers to my question",
    note: "Accepted first, then by votes. The asker accepts with the icon in its own column; votes use the question toggle.",
    render: () => (
      <Thread
        q={question()}
        list={sampleLiveAnswers}
        rights={{ canAnswer: true, canAccept: true, canVote: true, canModerate: false }}
      />
    ),
  },
  {
    id: "live-answer-removed",
    title: "Event app: my removed answer",
    note: "Only the author still sees a removed answer, with the reason and no moderator's name.",
    render: () => (
      <Thread
        q={question({ mine: false, answerCount: 1, acceptedAnswer: false })}
        list={[
          answer("c1", {
            authorName: "Ada Attendee",
            mine: true,
            text: "Buy our product, link in bio.",
            removal: { reason: "spam", at: AT, byName: null },
          }),
        ]}
        rights={{ canAnswer: true, canAccept: false, canVote: true, canModerate: false }}
      />
    ),
  },
  {
    id: "live-answer-blocked",
    title: "Event app: blocked for this session",
    note: "The warning takes the place of every post box. Reading and watching go on.",
    render: () => (
      <Thread
        blocked
        q={question({ mine: false })}
        list={sampleLiveAnswers}
        rights={{ canAnswer: false, canAccept: false, canVote: false, canModerate: false }}
      />
    ),
  },
  {
    id: "live-answer-moderator",
    title: "Event app: a moderator's answer actions",
    note: "Remove asks why; Pause, Block and Lift reach the author. Every item has a tooltip.",
    render: () => (
      <div data-gallery-open>
        <Thread
          q={question({ mine: false })}
          list={[sampleLiveAnswers[1]]}
          viewer={{ role: "operator", organizer: true }}
          rights={{ canAnswer: true, canAccept: true, canVote: false, canModerate: true }}
        />
      </div>
    ),
  },
  {
    id: "live-remove-dialog",
    title: "Event app: Remove dialog",
    note: "A reason is required; the author sees it.",
    render: () => <RemoveDialog />,
  },
];
