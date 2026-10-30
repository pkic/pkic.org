import { proposalSessionTypeLabel } from "../../../../../../shared/proposal-session-types";
/**
 * One proposal's own page.
 *
 * A record with facets: the header says what the proposal is and where it
 * stands, its commands sit behind one actions menu, one tab row switches
 * between its facets — the submission, the speakers, the reviews, the
 * presentation, the audit log, the decision — and the committee's standing
 * and private notes keep the column beside whichever facet is open. Inside a
 * group event each facet is a URL segment; on the standalone event route the
 * same page switches its panels in place.
 *
 * The version this replaces opened with a band of four stat cards restating
 * the header, squeezed the tab row into half the width beside a sidebar of
 * eight block buttons, and kept the open facet in a hash query parameter no
 * link could carry.
 */
import { useHashQueryParam } from "../../../../../hooks/useHashQueryParam";
import { useEffect, useState } from "preact/hooks";
import { usePortalHashLocation } from "../../../hash-location";
import { Badge } from "../../../../../components/Badge";
import { confirmAction } from "../../../../../components/ConfirmDialog";
import { Spinner } from "../../../../../components/Spinner";
import { ErrorAlert } from "../../../../../components/ErrorAlert";
import { Tabs, type TabItem } from "../../../../../components/Tabs";
import { getJson, patchJson, postJson } from "../../../../../shared/api-client";
import { fmt, toast } from "../../../ui";
import { copyText } from "../../../../../shared/clipboard";
import { useData } from "../../../../../hooks/useData";
import { FormAnswerTable } from "../../../../../components/forms/FormResponseViews";
import { AuditLogSection } from "./proposal-detail/AuditLogSection";
import { PresentationVersionsTab } from "./proposal-detail/PresentationVersionsTab";
import { ProposalStanding } from "./proposal-detail/ProposalStanding";
import { ProposalReviewsTab } from "./proposal-detail/ProposalReviewsTab";
import {
  proposalActions,
  type ProposalFlagAction,
  type ProposalReminderKind,
} from "./proposal-detail/proposal-actions";
import { proposalSpeakerEndpoints } from "./proposal-detail/proposal-api";
import {
  isProposalDecidableStatus,
  proposalFlagResponseSchema,
} from "../../../../../../shared/schemas/proposal-status";
import { proposalPatchSchema, proposalPatchResponseSchema } from "../../../../../../shared/schemas/proposal-management";
import { proposalSpeakerRemindersResponseSchema } from "../../../../../../shared/schemas/proposal-speakers";
import { useProposalSubresources } from "./proposal-detail/useProposalSubresources";
import type { DetailTab, ProposalResponse } from "./proposal-detail/model";
import { eventProposalDetailResponseSchema } from "../../../../../../shared/schemas/event-proposals";
import { PROPOSAL_COMMITTEE_NOTES_COPY } from "../../../../../../shared/proposal-committee-notes-copy";
import { proposalAccessLinkResponseSchema } from "../../../../../../shared/schemas/route-contracts-proposal-management";
import { ProposalDecisionPanel } from "./proposal-detail/ProposalDecisionPanel";
import { ProposalCancellationPanel } from "./proposal-detail/ProposalCancellationPanel";
import { proposalResourcePath } from "./proposal-detail/proposal-api";
import { ProposalSpeakersPanel } from "../../../../../components/proposals/ProposalSpeakersPanel";
import { ProposalCoSpeakerInviteForm } from "../../../../../components/proposals/ProposalCoSpeakerInviteForm";
import { ProposalInternalCommentsPanel } from "../../../../../components/proposals/ProposalInternalCommentsPanel";
import { Alert } from "../../../../../ui/Alert";
import { BreadcrumbBranch } from "../../../../../ui/BreadcrumbScope";
import { Button, ButtonLink } from "../../../../../ui/Button";
import { Field } from "../../../../../ui/Field";
import { Menu } from "../../../../../ui/Menu";
import { Panel, PanelBody, PanelHeader } from "../../../../../ui/Panel";
import { ProfileHeader } from "../../../../../ui/ProfileHeader";
import { eventProposalsViewPath } from "./proposal-paths";
import { eventRegistrationViewPath } from "./registration-paths";
import { portalEntityHref } from "../../../entity-links";
import { portalHasGlobalPermission } from "../../../shell/portal-navigation";
import { portalSession } from "../../../state";
// `pk-answer-pre` is written here as a class name rather than reached through
// a component, so this module has to pull its stylesheet into its own chunk.
import "../../../../../ui/Content.css";
import { MarkdownEditor } from "../../../../../components/markdown-editor/MarkdownInput";
import { Markdown } from "../../../../../ui/Markdown";
import { TextInput } from "../../../../../ui/TextControl";
import { useContractForm } from "../../../../../hooks/useContractForm";

const DETAIL_TABS: DetailTab[] = ["submission", "speakers", "reviews", "presentation", "audit-log", "decision"];
const DEFAULT_TAB: DetailTab = "submission";

function isDetailTab(value: string | undefined): value is DetailTab {
  return value !== undefined && (DETAIL_TABS as string[]).includes(value);
}

export function ProposalDetailPage({
  slug,
  proposalId,
  tab,
  segment,
  tabHref,
  parentNavigation = false,
}: {
  slug: string;
  proposalId: string;
  /** The URL-addressed facet, when the caller routes the facets. Unrecognized or unavailable selects Submission. */
  tab?: string;
  /** The segment below a facet: `"new"` under Speakers opens the invitation page. */
  segment?: string;
  /** Where each facet lives. Without it the tabs switch panels in place. */
  tabHref?: (key: DetailTab) => string;
  /** Inside a workspace whose breadcrumb this page extends; otherwise the page offers its own way back. */
  parentNavigation?: boolean;
}) {
  const [, navigate] = usePortalHashLocation();
  // Routed facets keep natural paths; embedded facets keep their selection in the URL.
  // An unavailable facet falls back below.
  const [localTab, setLocalTab] = useHashQueryParam("proposalSection", DEFAULT_TAB, DETAIL_TABS);
  const requestedTab: DetailTab = tabHref ? (isDetailTab(tab) ? tab : DEFAULT_TAB) : localTab;
  const [commandError, setCommandError] = useState<string | null>(null);

  const { data, loading, error, reload } = useData<ProposalResponse>(
    async () => getJson(proposalResourcePath(proposalId), eventProposalDetailResponseSchema),
    [proposalId],
  );

  const subresources = useProposalSubresources(proposalId, reload, data?.access);
  const {
    reviews,
    reviewPage,
    reviewSummary,
    myReview,
    loadingMoreReviews,
    comments,
    commentPage,
    loadingMoreComments,
    loading: loadingSub,
    savingComment,
    reviewSaved: handleReviewSaved,
    addComment,
    loadMoreComments: handleLoadMoreComments,
    loadMoreReviews: handleLoadMoreReviews,
  } = subresources;

  // Title and abstract editing
  const [editingAbstract, setEditingAbstract] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [submissionError, setSubmissionError] = useState("");
  const [abstractDraft, setAbstractDraft] = useState("");
  const [savingAbstract, setSavingAbstract] = useState(false);
  const submissionForm = useContractForm(proposalPatchSchema, {
    ...(titleDraft !== data?.proposal.title ? { title: titleDraft } : {}),
    ...(abstractDraft !== data?.proposal.abstract ? { abstract: abstractDraft } : {}),
  });

  // Internal comments
  const [commentDraft, setCommentDraft] = useState("");
  // Sync the editable abstract when proposal data (re)loads.
  useEffect(() => {
    if (data?.proposal) {
      setTitleDraft(data.proposal.title);
      setAbstractDraft(data.proposal.abstract);
    }
  }, [data]);

  if (loading) return <Spinner />;
  if (error && !data) return <ErrorAlert error={error} />;
  if (!data) return null;

  const { proposal, access, form, minReviewsRequired, sessionTypes } = data;
  const proposer = [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ") || "Proposer";
  const proposalRequiresPresentation =
    sessionTypes.find((t) => t.label.toLowerCase() === proposal.proposal_type.toLowerCase())?.requiresPresentation ??
    false;
  const proposalDecidable = isProposalDecidableStatus(proposal.status);
  const canEditAbstract = proposal.status === "accepted" ? access.canEditAcceptedAbstract : access.canFinalize;
  // A speaker's registration opens on the event's registrations page, which
  // asks for registration management on this event or everywhere.
  const canManageRegistrations =
    access.eventPermissions.includes("events:manage") ||
    portalHasGlobalPermission(portalSession.value, "events:manage");
  // Who a speaker is lives on the person and the identity they speak as, so
  // changing it asks for the permission that guards those, not for proposal
  // management.
  const speakerProfileAccess = {
    canEditIdentity: portalHasGlobalPermission(portalSession.value, "membership:write"),
    canEditHeadshot: portalHasGlobalPermission(portalSession.value, "users:write"),
  };
  const reviewCount = reviewSummary.totalReviews;
  const quorumMet = reviewSummary.quorumMet;
  const recommendationCounts = {
    accept: reviewSummary.acceptCount,
    "needs-work": reviewSummary.needsWorkCount,
    reject: reviewSummary.rejectCount,
  };
  const showDecision =
    (access.canFinalize && (proposalDecidable || Boolean(proposal.decision_status))) ||
    (access.canCancelAcceptedProposal && proposal.status === "accepted") ||
    proposal.status === "canceled";

  const tabItems: Array<TabItem & { key: DetailTab }> = [
    { key: "submission", label: "Submission" },
    { key: "speakers", label: "Speakers" },
    ...(access.canReview
      ? [{ key: "reviews" as const, label: `Reviews (${loadingSub ? "…" : String(reviewCount)})` }]
      : []),
    ...(access.canRead ? [{ key: "presentation" as const, label: "Presentation" }] : []),
    ...(access.canReview ? [{ key: "audit-log" as const, label: "Audit log" }] : []),
    ...(showDecision ? [{ key: "decision" as const, label: "Decision" }] : []),
  ];
  // A facet the identity cannot see, or one the proposal no longer has, is
  // not an error: the page opens on the submission instead.
  const activeTab: DetailTab = tabItems.some((item) => item.key === requestedTab) ? requestedTab : DEFAULT_TAB;

  function openTab(key: string): void {
    if (!isDetailTab(key)) return;
    if (tabHref) navigate(tabHref(key));
    else setLocalTab(key);
  }

  // Inviting is a page under the Speakers facet, so it needs an address: an
  // operator on a routed page gets the link, one on a panel-switching page
  // does not.
  const speakersPath = tabHref ? tabHref("speakers") : null;
  const invitePath = speakersPath && access.canFinalize ? `${speakersPath}/new` : null;
  const inviting = activeTab === "speakers" && segment === "new" && invitePath !== null;
  const [rosterRevision, setRosterRevision] = useState(0);

  async function handleFlag(action: ProposalFlagAction) {
    const verb = action === "delete" ? "Delete" : action === "spam" ? "Mark as spam" : "Mark as duplicate";
    const consequence =
      action === "delete"
        ? "The proposal is soft-deleted and no longer appears in proposal listings"
        : `The proposal status changes to "${action}"`;
    if (
      !(await confirmAction({
        title: `${verb} "${proposal.title}"?`,
        consequences: [consequence, "This is not easily reversible"],
        confirmLabel: verb,
      }))
    )
      return;
    setCommandError(null);
    try {
      await postJson(proposalResourcePath(proposalId, "moderations"), { action }, proposalFlagResponseSchema);
      toast(`Proposal ${action === "delete" ? "deleted" : `marked as ${action}`}`, "success");
      void reload();
    } catch (err) {
      setCommandError((err as Error).message);
    }
  }

  async function handleOpenManage() {
    setCommandError(null);
    try {
      const { manageUrl } = await postJson(
        proposalResourcePath(proposalId, "access-links"),
        {},
        proposalAccessLinkResponseSchema,
      );
      window.open(manageUrl, "_blank", "noopener");
    } catch (e) {
      setCommandError((e as Error).message);
    }
  }

  async function handleCopyProposerEmail() {
    await copyText(proposal.proposer_email, {
      copied: "Proposer email copied",
      failed: "Could not copy the proposer's address. Open the speaker's profile details to copy it manually.",
      // A failure stays on the page, where the manual way out can still be read.
      notify: (message, type) => (type === "error" ? setCommandError(message) : toast(message, type)),
    });
  }

  async function handleRemind(kind: ProposalReminderKind) {
    // A failed reminder is stated on the page rather than only in a toast, so
    // the operator can still read why it failed after the toast has gone.
    setCommandError(null);
    try {
      const response = await postJson(
        proposalResourcePath(proposalId, "speakers/reminders"),
        { kind },
        proposalSpeakerRemindersResponseSchema,
      );
      toast(
        `${kind === "profile" ? "Profile" : "Presentation"} reminder sent to ${String(response.queued)} speaker(s)`,
        "success",
      );
    } catch (caught) {
      setCommandError((caught as Error).message);
    }
  }

  async function handleSaveAbstract(e: Event) {
    e.preventDefault();
    setSubmissionError("");
    const checked = submissionForm.submit();
    if (!checked.data) {
      setSubmissionError(checked.formMessage ?? "");
      return;
    }
    setSavingAbstract(true);
    try {
      await patchJson(proposalResourcePath(proposalId), checked.data, proposalPatchResponseSchema);
      setEditingAbstract(false);
      toast("Title and abstract updated", "success");
      void reload();
    } catch (err) {
      setSubmissionError(submissionForm.refuse(err));
    } finally {
      setSavingAbstract(false);
    }
  }

  async function handleComment(e: Event) {
    e.preventDefault();
    const comment = commentDraft.trim();
    if (!comment) return;
    if (await addComment(comment)) {
      setCommentDraft("");
      toast("Comment added", "success");
    }
  }

  const actions = proposalActions({
    proposal,
    access,
    proposalRequiresPresentation,
    onOpenManage: () => void handleOpenManage(),
    onCopyProposerEmail: () => void handleCopyProposerEmail(),
    onRemind: (kind) => void handleRemind(kind),
    onFlag: (action) => void handleFlag(action),
  });

  const page = (
    <section class="pk pk-stack" aria-label={`Proposal: ${proposal.title}`}>
      {error && <ErrorAlert error={error} />}
      {!parentNavigation && (
        // The page's way back, when no breadcrumb carries it.
        <div class="pk-cluster">
          <ButtonLink variant="link" href={usePortalHashLocation.hrefs(eventProposalsViewPath(slug))}>
            ← All proposals
          </ButtonLink>
        </div>
      )}
      <ProfileHeader
        title={proposal.title}
        context={
          <>
            <Badge status={proposal.status} />
            {/* The decision is its own badge only while it differs from the
                workflow status; an accepted proposal reads "Accepted" once. */}
            {proposal.decision_status && proposal.decision_status !== proposal.status && (
              <Badge status={proposal.decision_status} />
            )}
          </>
        }
        lede={`${proposalSessionTypeLabel(proposal.proposal_type, sessionTypes)} · proposed by ${proposer}`}
        facts={[`Submitted ${fmt(proposal.submitted_at)}`]}
        actions={actions.length > 0 ? <Menu label="Proposal actions" align="end" items={actions} /> : undefined}
      />
      {commandError && <Alert tone="danger">{commandError}</Alert>}

      {/* Named for what it switches: the group workspace's own strip sits on
          the same page, with an "Audit log" tab of its own. */}
      <Tabs
        items={tabItems}
        active={activeTab}
        label="Proposal sections"
        {...(tabHref ? { hrefFor: (key: string) => tabHref(isDetailTab(key) ? key : DEFAULT_TAB) } : {})}
        onChange={openTab}
      />

      {/* The open facet takes the width; the committee's standing and its
          private notes keep the column beside it whichever facet is open. */}
      <div class="pk-record">
        <div class="pk-stack">
          {activeTab === "submission" && (
            <Panel>
              <PanelHeader
                title="Abstract"
                menu={
                  canEditAbstract && !editingAbstract ? (
                    <Menu
                      label="Abstract actions"
                      align="end"
                      items={[
                        {
                          id: "edit",
                          label: "Edit title and abstract",
                          onSelect: () => {
                            setTitleDraft(proposal.title);
                            setAbstractDraft(proposal.abstract);
                            setSubmissionError("");
                            submissionForm.reset();
                            setEditingAbstract(true);
                          },
                        },
                      ]}
                    />
                  ) : undefined
                }
              />
              <PanelBody>
                {editingAbstract ? (
                  <form
                    class="pk-stack"
                    noValidate
                    {...submissionForm.handlers}
                    onSubmit={(e) => void handleSaveAbstract(e)}
                  >
                    {submissionError && <Alert tone="danger">{submissionError}</Alert>}
                    <Field label="Title" required {...submissionForm.of("title")}>
                      {(control) => (
                        <TextInput
                          {...control}
                          name="title"
                          value={titleDraft}
                          onInput={(e) => setTitleDraft(e.currentTarget.value)}
                        />
                      )}
                    </Field>
                    <Field label="Abstract" required help="Markdown is supported." {...submissionForm.of("abstract")}>
                      {(control) => (
                        <MarkdownEditor
                          variant="compact"
                          {...control}
                          name="abstract"
                          label="Abstract"
                          initialValue={abstractDraft}
                          onChange={setAbstractDraft}
                        />
                      )}
                    </Field>
                    <div class="pk-cluster">
                      <Button type="submit" variant="primary" loading={savingAbstract}>
                        {savingAbstract ? "Saving…" : "Save"}
                      </Button>
                      <Button type="button" onClick={() => setEditingAbstract(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : proposal.abstract ? (
                  <Markdown markdown={proposal.abstract} />
                ) : (
                  <p class="pk-muted">—</p>
                )}
              </PanelBody>

              {proposal.committee_notes && (
                <>
                  <PanelHeader headingLevel={4} title={PROPOSAL_COMMITTEE_NOTES_COPY.reviewTitle} />
                  <PanelBody class="pk-stack pk-stack--snug">
                    <p class="pk-small pk-muted">{PROPOSAL_COMMITTEE_NOTES_COPY.reviewHelp}</p>
                    <p class="pk-prose-block">{proposal.committee_notes}</p>
                  </PanelBody>
                </>
              )}

              {proposal.details && Object.keys(proposal.details).length > 0 && (
                <>
                  {/* The form's own name is configuration, not something the
                      reader of a proposal needs to see. */}
                  <PanelHeader headingLevel={4} title="Submission" />
                  <PanelBody>
                    <FormAnswerTable answers={proposal.details} fields={form?.fields} />
                  </PanelBody>
                </>
              )}
            </Panel>
          )}

          {activeTab === "speakers" &&
            (inviting && speakersPath ? (
              <ProposalCoSpeakerInviteForm
                endpoint={proposalResourcePath(proposalId, "speakers")}
                event={data.event}
                notify={toast}
                cancelHref={usePortalHashLocation.hrefs(speakersPath)}
                onInvited={async () => {
                  setRosterRevision((revision) => revision + 1);
                  await reload();
                  navigate(speakersPath);
                }}
              />
            ) : access.canRead ? (
              <ProposalSpeakersPanel
                endpoint={proposalResourcePath(proposalId)}
                proposalId={proposalId}
                access={access}
                proposal={proposal}
                sessionTypes={sessionTypes}
                onReload={reload}
                notify={toast}
                endpoints={proposalSpeakerEndpoints()}
                invitePath={invitePath ? usePortalHashLocation.hrefs(invitePath) : undefined}
                refreshKey={rosterRevision}
                userHref={(userId) => {
                  const path = portalEntityHref("user", userId);
                  return path ? usePortalHashLocation.hrefs(path) : undefined;
                }}
                identityHref={(userId) => {
                  // A person's identities are shown on their professional profile, under their record.
                  const path = portalEntityHref("user", userId);
                  return path ? usePortalHashLocation.hrefs(`${path}/profile`) : undefined;
                }}
                profileAccess={speakerProfileAccess}
                registrationHref={
                  canManageRegistrations
                    ? (registrationId) => usePortalHashLocation.hrefs(eventRegistrationViewPath(slug, registrationId))
                    : undefined
                }
              />
            ) : (
              <Alert tone="info">Speaker access requires proposal read permission.</Alert>
            ))}

          {activeTab === "presentation" && (
            <PresentationVersionsTab proposalId={proposalId} canManage={access.canFinalize} />
          )}

          {activeTab === "reviews" && (
            <ProposalReviewsTab
              proposalId={proposalId}
              loading={loadingSub}
              reviews={reviews}
              page={reviewPage}
              summary={reviewSummary}
              minReviewsRequired={minReviewsRequired}
              canReview={access.canReview}
              reviewLocked={!proposalDecidable}
              myReview={myReview}
              loadingMore={loadingMoreReviews}
              onLoadMore={handleLoadMoreReviews}
              onSaved={handleReviewSaved}
            />
          )}

          {activeTab === "audit-log" && (
            <Panel>
              <PanelHeader title="Audit log" />
              <PanelBody>
                <AuditLogSection proposalId={proposalId} enabled={access.canReview} />
              </PanelBody>
            </Panel>
          )}

          {activeTab === "decision" && (
            <>
              {access.canFinalize && (proposalDecidable || proposal.decision_status) && (
                <ProposalDecisionPanel
                  proposalId={proposalId}
                  proposal={proposal}
                  reviewCount={reviewCount}
                  minReviewsRequired={minReviewsRequired}
                  loading={loadingSub}
                  onSaved={() => void reload()}
                />
              )}
              <ProposalCancellationPanel
                proposalId={proposalId}
                proposal={proposal}
                canCancel={access.canCancelAcceptedProposal}
                onSaved={() => void reload()}
              />
            </>
          )}
        </div>

        <div class="pk-stack pk-datalist-aligned">
          <ProposalStanding
            proposal={proposal}
            loading={loadingSub}
            reviewCount={reviewCount}
            minReviewsRequired={minReviewsRequired}
            quorumMet={quorumMet}
            averageScore={reviewSummary.averageScore}
            recommendationCounts={recommendationCounts}
          />
          {access.canReview && (
            <ProposalInternalCommentsPanel
              commentDraft={commentDraft}
              savingComment={savingComment}
              comments={comments}
              commentsPage={commentPage}
              loadingMoreComments={loadingMoreComments}
              onCommentDraftChange={setCommentDraft}
              onAddComment={handleComment}
              onLoadMoreComments={handleLoadMoreComments}
            />
          )}
        </div>
      </div>
    </section>
  );

  return parentNavigation ? <BreadcrumbBranch items={[{ label: proposal.title }]}>{page}</BreadcrumbBranch> : page;
}
