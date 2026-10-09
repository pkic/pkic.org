import type { SessionSourceDecision } from "../../assets/shared/schemas/event-session-history";

interface ReviewedTitle {
  decision: Extract<SessionSourceDecision["decision"], "reviewed_title" | "title_not_recorded">;
  value?: string;
  reviewedAt: SessionSourceDecision["reviewedAt"];
}
interface ReviewedCredit {
  decision: Extract<
    SessionSourceDecision["decision"],
    "credit_not_recorded" | "retain_source_credit" | "reviewed_credit"
  >;
  resolvedValue?: string;
  reviewedAt: SessionSourceDecision["reviewedAt"];
}
export function resolveLegacyAgendaRow(
  session: { title?: string | null; speakers?: string[] },
  context: {
    sourcePath: string;
    sourceDigest: string;
    date: string;
    slotIndex: number;
    sessionIndex: number;
    originalSourceKey: string;
    title?: string | null;
  },
  mappings: {
    archivePublicSource?: boolean;
    sourceRows?: Record<
      string,
      {
        sourceDigest: string;
        sourceKey?: string;
        reviewedAt?: string;
        title?: ReviewedTitle;
        credits?: Record<string, ReviewedCredit>;
      }
    >;
    speakerUserIds?: Record<string, string>;
    historicalPeople?: Record<
      string,
      {
        userId?: string;
        actingIdentityId?: string | null;
        approvedAt?: string;
        role?: string;
      }
    >;
  },
): {
  sourceKey: string;
  title: string;
  names: string[];
  sourceRoles: Record<string, "speaker" | "moderator">;
  decisions: SessionSourceDecision[];
  creditDecisions: Record<string, ReviewedCredit>;
  unresolved: { kind: "source_decision"; sourceLocator: string; sourceKey: string; message: string }[];
  sourceRow: {
    sourceLocator: string;
    sourceKey: string;
    originalSourceKey: string;
    sourcePath: string;
    sourceDigest: string;
    keyReviewedAt?: string;
    authoredTitle: string | null;
    authoredCredits: string[];
    authoredSpeakerReferences: string[];
  };
};
