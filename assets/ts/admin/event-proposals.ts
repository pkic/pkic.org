import { ADMIN_LIST_PAGE_SIZE_DEFAULT, pagerHtml } from "./pager";
import { badge, esc, fmt, hide, q, show, spinner, tbl, toast } from "./ui";
import type {
  ApiFn,
  ProposalAccess,
  ProposalReview,
  ProposalSpeaker,
  ProposalSummary,
} from "./types";

interface ProposalsSectionDeps {
  emailTabHtml: (ns: string) => string;
  wireEmailTab: (slug: string, ns: string, audience: "attendees" | "speakers") => Promise<void>;
  getEmail: () => string | null;
  proposalInviteFormHtml: () => string;
  proposalInviteListHtml: () => string;
  wireProposalInviteForm: (slug: string) => void;
  loadProposalInvites: (slug: string, statusFilter?: string) => Promise<void>;
}

export function createProposalsSection(
  api: ApiFn,
  deps: ProposalsSectionDeps,
): {
  proposalsGroupTabHtml: () => string;
  wireProposalsGroupTabs: (slug: string) => void;
  loadEventProposals: (slug: string) => Promise<void>;
} {
  const { emailTabHtml, wireEmailTab, getEmail, proposalInviteFormHtml, proposalInviteListHtml, wireProposalInviteForm, loadProposalInvites } = deps;

  let _proposalAccessByEventSlug: Record<string, ProposalAccess> = {};

  function proposalsGroupTabHtml(): string {
    return (
      '<ul class="nav nav-tabs mb-3">' +
        '<li class="nav-item"><button class="nav-link active" data-prop-tab="proposals">Proposals</button></li>' +
        '<li class="nav-item"><button class="nav-link" data-prop-tab="prop-invlist">Invite List</button></li>' +
        '<li class="nav-item"><button class="nav-link" data-prop-tab="prop-invite">Send Invite</button></li>' +
        '<li class="nav-item"><button class="nav-link" data-prop-tab="prop-email">Send Email</button></li>' +
      '</ul>' +
      `<div id="et-proposals">${proposalsTabHtml()}</div>` +
      `<div id="et-prop-invlist" class="d-none">${proposalInviteListHtml()}</div>` +
      `<div id="et-prop-invite" class="d-none">${proposalInviteFormHtml()}</div>` +
      `<div id="et-prop-email" class="d-none">${emailTabHtml("prop")}</div>`
    );
  }


  function wireProposalsGroupTabs(slug: string): void {
    const root = q("#et-proposals-group");
    if (!root) return;
    root.querySelectorAll<HTMLButtonElement>("[data-prop-tab]").forEach((btn) => {
      btn.onclick = () => {
        root.querySelectorAll<HTMLButtonElement>("[data-prop-tab]").forEach((b) => b.classList.remove("active"));
        ["proposals", "prop-invlist", "prop-invite", "prop-email"].forEach((id) => hide(q(`#et-${id}`)));
        btn.classList.add("active");
        const tab = btn.dataset.propTab!;
        show(q(`#et-${tab}`));
        if (tab === "proposals") void loadEventProposals(slug);
        if (tab === "prop-invlist") void loadProposalInvites(slug);
        if (tab === "prop-invite") wireProposalInviteForm(slug);
        if (tab === "prop-email") void wireEmailTab(slug, "prop", "speakers");
      };
    });
  }


  function proposalsTabHtml(): string {
    return (
      '<div class="d-flex gap-2 align-items-center mb-3 flex-wrap">' +
        '<label class="form-label mb-0 small fw-semibold" for="proposal-filter">Status</label>' +
        '<select class="form-select form-select-sm" id="proposal-filter" style="width:auto">' +
          '<option value="">All</option>' +
          '<option value="submitted">Submitted</option>' +
          '<option value="under_review">Under Review</option>' +
          '<option value="accepted">Accepted</option>' +
          '<option value="rejected">Rejected</option>' +
          '<option value="needs_work">Needs Work</option>' +
          '<option value="withdrawn">Withdrawn</option>' +
        '</select>' +
        '<input class="form-control form-control-sm" id="proposal-search" type="search" placeholder="Search title or proposer" style="max-width:300px">' +
        '<button class="btn btn-sm btn-outline-secondary" id="proposal-refresh">&circlearrowright; Refresh</button>' +
      '</div>' +
      '<div id="proposal-list-body">' + spinner() + '</div>' +
      '<div id="proposal-list-pager" class="mt-2"></div>' +
      '<div id="proposal-detail" class="mt-3"></div>'
    );
  }


  async function loadEventProposals(slug: string): Promise<void> {
    const body = q("#proposal-list-body");
    const pager = q("#proposal-list-pager");
    if (!body) return;
    if (pager) pager.innerHTML = "";

    let offset = 0;
    let pageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT;

    const fetchAndRender = async (): Promise<void> => {
      body.innerHTML = spinner();
      try {
        const filter = q<HTMLSelectElement>("#proposal-filter")?.value ?? "";
        const search = (q<HTMLInputElement>("#proposal-search")?.value ?? "").trim().toLowerCase();
        const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
        if (filter) query.set("status", filter);
        if (search) query.set("search", search);

        const response = await api<{
          proposals: ProposalSummary[];
          permissions?: ProposalAccess;
          page?: { limit: number; offset: number; hasMore: boolean; total: number };
        }>(`/api/v1/admin/events/${slug}/proposals?${query.toString()}`);
        const access: ProposalAccess = response.permissions ?? { eventPermissions: [], canReview: true, canFinalize: true };
        _proposalAccessByEventSlug[slug] = access;
        const proposals = response.proposals ?? [];

        const rows = proposals.map((proposal) => {
          const proposerName = [proposal.proposer_first_name, proposal.proposer_last_name].filter(Boolean).join(" ");
          const proposerLabel = proposerName
            ? `${esc(proposerName)}<br><span class="mono text-muted" style="font-size:.72rem">${esc(proposal.proposer_email)}</span>`
            : `<span class="mono">${esc(proposal.proposer_email)}</span>`;
          const decisionLabel = proposal.decision_status
            ? `${badge(proposal.decision_status)}<div class="small text-muted">${fmt(proposal.decision_decided_at)}</div>`
            : '<span class="text-muted small">Not finalized</span>';
          return (
            `<tr>` +
            `<td><div class="fw-semibold">${esc(proposal.title)}</div><div class="small text-muted">${esc(proposal.proposal_type)}</div></td>` +
            `<td>${proposerLabel}</td>` +
            `<td>${badge(proposal.status)}</td>` +
            `<td class="mono text-center">${Number(proposal.review_count ?? 0)}</td>` +
            `<td>${decisionLabel}</td>` +
            `<td class="mono">${fmt(proposal.submitted_at)}</td>` +
            `<td><button class="btn btn-sm btn-outline-primary" data-open-proposal="${esc(proposal.id)}">${access.canReview ? "Review" : "View"}</button></td>` +
            `</tr>`
          );
        });

        body.innerHTML = tbl(
          ["Proposal", "Proposer", "Status", "Reviews", "Decision", "Submitted", ""],
          rows,
          "No proposals match the current filters",
        );

        const pageOffset = response.page?.offset ?? offset;
        const pageLimit = response.page?.limit ?? pageSize;
        const hasMore = response.page?.hasMore ?? false;
        const pageTotal = response.page?.total ?? 0;
        const currentPage = Math.floor(pageOffset / Math.max(1, pageLimit)) + 1;

        if (pager) {
          pager.innerHTML = pagerHtml(currentPage, hasMore, pageLimit, pageOffset, proposals.length, pageTotal);
          pager.querySelector<HTMLButtonElement>("[data-page-prev]")?.addEventListener("click", () => {
            offset = Math.max(0, pageOffset - pageLimit);
            void fetchAndRender();
          });
          pager.querySelector<HTMLButtonElement>("[data-page-next]")?.addEventListener("click", () => {
            offset = pageOffset + pageLimit;
            void fetchAndRender();
          });
          pager.querySelectorAll<HTMLButtonElement>("[data-page-jump]").forEach((btn) => {
            btn.addEventListener("click", () => {
              const page = Number(btn.dataset.pageJump || "1");
              if (!Number.isFinite(page) || page < 1) return;
              offset = (page - 1) * pageLimit;
              void fetchAndRender();
            });
          });
          pager.querySelector<HTMLSelectElement>("[data-page-size]")?.addEventListener("change", (event) => {
            const nextSize = Number((event.currentTarget as HTMLSelectElement).value);
            if (!Number.isFinite(nextSize) || nextSize < 1) return;
            pageSize = nextSize;
            offset = 0;
            void fetchAndRender();
          });
        }

        body.querySelectorAll<HTMLButtonElement>("[data-open-proposal]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const proposal = (response.proposals ?? []).find((p) => p.id === btn.dataset.openProposal);
            if (!proposal) return;
            void loadProposalDetail(slug, proposal, access);
          });
        });
      } catch (err) {
        body.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
        if (pager) pager.innerHTML = "";
      }
    };

    const bodyEl = body as HTMLElement;
    if (!bodyEl.dataset.proposalWired) {
      bodyEl.dataset.proposalWired = "1";
      q("#proposal-refresh")?.addEventListener("click", () => {
        offset = 0;
        void fetchAndRender();
      });
      q("#proposal-filter")?.addEventListener("change", () => {
        offset = 0;
        void fetchAndRender();
      });
      q("#proposal-search")?.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter") {
          event.preventDefault();
          offset = 0;
          void fetchAndRender();
        }
      });
    }

    await fetchAndRender();
  }


  async function loadProposalDetail(slug: string, proposal: ProposalSummary, access: ProposalAccess): Promise<void> {
    const detail = q("#proposal-detail");
    if (!detail) return;
    detail.innerHTML = spinner();

    try {
      const [reviewsResp, speakersResp] = await Promise.all([
        api<{ reviews: ProposalReview[] }>(`/api/v1/admin/proposals/${proposal.id}/reviews`),
        api<{ speakers: ProposalSpeaker[]; summary: { confirmed: number; total: number; profileComplete: number } }>(
          `/api/v1/admin/proposals/${proposal.id}/speakers`,
        ),
      ]);

      const reviews = reviewsResp.reviews ?? [];
      const speakers = speakersResp.speakers ?? [];
      const currentEmail = getEmail();
      const ownReview = reviews.find((r) => r.reviewer_email?.toLowerCase() === (currentEmail ?? "").toLowerCase()) ?? null;

      const speakerRows = speakers.map((speaker) => {
        const displayName = [speaker.firstName, speaker.lastName].filter(Boolean).join(" ");
        const roleLabel = speaker.role === "proposer" && speaker.hasBio ? "proposer / speaker" : speaker.role;
        return (
          `<tr>` +
          `<td>${displayName ? esc(displayName) : '<span class="text-muted">—</span>'}<br><span class="mono text-muted small">${esc(speaker.email)}</span></td>` +
          `<td>${badge(roleLabel)}</td>` +
          `<td>${badge(speaker.status)}</td>` +
          `<td>${speaker.hasBio ? '<span class="text-success">Yes</span>' : '<span class="text-muted">No</span>'}</td>` +
          `<td>${speaker.hasHeadshot ? '<span class="text-success">Yes</span>' : '<span class="text-muted">No</span>'}</td>` +
          `</tr>`
        );
      });

      const reviewRows = reviews.map((review) => {
        const reviewerName = [review.reviewer_first_name, review.reviewer_last_name].filter(Boolean).join(" ");
        const who = reviewerName || review.reviewer_email || review.reviewer_user_id;
        return (
          `<tr>` +
          `<td>${esc(who)}</td>` +
          `<td>${badge(review.recommendation)}</td>` +
          `<td class="mono">${review.score ?? "—"}</td>` +
          `<td class="small">${esc(review.reviewer_comment ?? "—")}</td>` +
          `<td class="mono">${fmt(review.updated_at)}</td>` +
          `</tr>`
        );
      });

      detail.innerHTML =
        '<div class="card border-0 shadow-sm">' +
        '<div class="card-header bg-white d-flex align-items-center justify-content-between">' +
          `<div><div class="fw-semibold">${esc(proposal.title)}</div>` +
          `<div class="small text-muted">${esc(proposal.proposal_type)} · ${badge(proposal.status)}</div></div>` +
          '<button class="btn btn-sm btn-outline-secondary" id="btn-close-proposal-detail">Close</button>' +
        '</div>' +
        '<div class="card-body">' +
          `<p class="small mb-2"><strong>Abstract:</strong><br>${esc(proposal.abstract)}</p>` +
          '<div class="row g-3 mb-3">' +
            '<div class="col-md-6">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-2">Speakers</h6>' +
              `<div class="small text-muted mb-2">Confirmed ${speakersResp.summary?.confirmed ?? 0}/${speakersResp.summary?.total ?? speakers.length}, Profiles complete ${speakersResp.summary?.profileComplete ?? 0}</div>` +
              tbl(["Speaker", "Role", "Status", "Bio", "Headshot"], speakerRows, "No speakers linked") +
            '</div>' +
            '<div class="col-md-6">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-2">Committee Reviews</h6>' +
              tbl(["Reviewer", "Recommendation", "Score", "Comment", "Updated"], reviewRows, "No reviews submitted") +
            '</div>' +
          '</div>' +

          '<div class="row g-3">' +
            '<div class="col-md-6">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-2">My Review</h6>' +
              (access.canReview
                ? '<div class="card border"><div class="card-body">' +
                    `<div class="small text-muted mb-2">${ownReview ? `Review last updated ${esc(fmt(ownReview.updated_at))}.` : "No review submitted yet."}</div>` +
                    '<div class="d-flex align-items-center gap-2 mb-2">' +
                      `<button class="btn btn-sm btn-outline-primary" id="btn-proposal-toggle-review-form">${ownReview ? "Edit My Review" : "Add My Review"}</button>` +
                      '<span class="small" id="proposal-review-status"></span>' +
                    '</div>' +
                    '<div class="d-none" id="proposal-review-form-wrap">' +
                      '<div class="mb-2"><label class="form-label small fw-semibold mb-1">Recommendation</label>' +
                        `<select class="form-select form-select-sm" id="proposal-review-recommendation">` +
                          `<option value="accept"${ownReview?.recommendation === "accept" ? " selected" : ""}>Accept</option>` +
                          `<option value="needs-work"${ownReview?.recommendation === "needs-work" ? " selected" : ""}>Needs Work</option>` +
                          `<option value="reject"${ownReview?.recommendation === "reject" ? " selected" : ""}>Reject</option>` +
                        '</select></div>' +
                      '<div class="mb-2"><label class="form-label small fw-semibold mb-1" for="proposal-review-score">Score <span class="text-muted" id="proposal-review-score-value">' +
                        `${esc(ownReview?.score ?? 5)}/10` +
                      '</span></label>' +
                        `<input class="form-range" id="proposal-review-score" type="range" min="1" max="10" step="1" value="${esc(ownReview?.score ?? 5)}" aria-describedby="proposal-review-score-value"></div>` +
                      '<div class="mb-2"><label class="form-label small fw-semibold mb-1">Committee Comment</label>' +
                        `<textarea class="form-control form-control-sm" id="proposal-review-comment" rows="4">${esc(ownReview?.reviewer_comment ?? "")}</textarea></div>` +
                      '<div class="mb-2"><label class="form-label small fw-semibold mb-1">Applicant Note (optional)</label>' +
                        `<textarea class="form-control form-control-sm" id="proposal-review-applicant-note" rows="3">${esc(ownReview?.applicant_note ?? "")}</textarea></div>` +
                      '<div class="d-flex align-items-center gap-2">' +
                        '<button class="btn btn-sm btn-primary" id="btn-proposal-save-review">Save Review</button>' +
                        '<button class="btn btn-sm btn-outline-secondary" id="btn-proposal-cancel-review-form">Cancel</button>' +
                      '</div>' +
                    '</div>' +
                  '</div></div>'
                : '<div class="card border"><div class="card-body small text-muted">You do not have permission to submit committee reviews for this event.</div></div>') +
            '</div>' +

            '<div class="col-md-6">' +
              '<h6 class="text-uppercase small fw-bold text-muted mb-2">Finalize Decision</h6>' +
              (access.canFinalize
                ? '<div class="card border"><div class="card-body">' +
                    '<div class="small text-muted mb-2">Use this when the committee reached final consensus. Policy review threshold is enforced automatically.</div>' +
                    '<div class="d-flex align-items-center gap-2 mb-2">' +
                      '<button class="btn btn-sm btn-outline-success" id="btn-proposal-toggle-finalize-form">Open Finalize Form</button>' +
                      '<span class="small" id="proposal-finalize-status"></span>' +
                    '</div>' +
                    '<div class="d-none" id="proposal-finalize-form-wrap">' +
                      '<div class="mb-2"><label class="form-label small fw-semibold mb-1">Final status</label>' +
                        '<select class="form-select form-select-sm" id="proposal-final-status">' +
                          '<option value="accepted">Accepted</option>' +
                          '<option value="needs_work">Needs Work</option>' +
                          '<option value="rejected">Rejected</option>' +
                        '</select></div>' +
                      '<div class="mb-2"><label class="form-label small fw-semibold mb-1">Decision note</label>' +
                        '<textarea class="form-control form-control-sm" id="proposal-final-note" rows="3" placeholder="Optional summary for proposer"></textarea></div>' +
                      '<div class="row g-2 mb-1">' +
                        '<div class="col-md-6 d-none" id="proposal-presentation-deadline-wrap"><label class="form-label small fw-semibold mb-1">Presentation deadline (accepted only)</label>' +
                          '<input class="form-control form-control-sm" id="proposal-presentation-deadline" type="datetime-local"></div>' +
                      '</div>' +
                      '<div class="small text-muted mb-2">Presentation deadline is optional and only used when status is Accepted.</div>' +
                      '<div class="form-check mb-2">' +
                        '<input class="form-check-input" type="checkbox" id="proposal-final-confirm">' +
                        '<label class="form-check-label small" for="proposal-final-confirm">I confirm this is the final committee decision for this proposal.</label>' +
                      '</div>' +
                      '<div class="d-flex align-items-center gap-2 flex-wrap">' +
                        '<button class="btn btn-sm btn-outline-secondary" id="btn-proposal-preview-finalize">Preview</button>' +
                        '<button class="btn btn-sm btn-success" id="btn-proposal-finalize" disabled>Finalize Decision</button>' +
                        '<button class="btn btn-sm btn-outline-secondary" id="btn-proposal-cancel-finalize-form">Cancel</button>' +
                      '</div>' +
                    '</div>' +
                  '</div></div>'
                : '<div class="card border"><div class="card-body small text-muted">Only organizers can finalize proposal decisions for this event.</div></div>') +
            '</div>' +
          '</div>' +
        '</div>' +
        '</div>';

      q("#btn-close-proposal-detail")?.addEventListener("click", () => {
        const el = q("#proposal-detail");
        if (el) el.innerHTML = "";
      });

      const reviewFormWrap = q("#proposal-review-form-wrap");
      const toggleReviewFormBtn = q<HTMLButtonElement>("#btn-proposal-toggle-review-form");
      q("#btn-proposal-toggle-review-form")?.addEventListener("click", () => {
        const hidden = reviewFormWrap?.classList.contains("d-none") ?? true;
        if (hidden) {
          show(reviewFormWrap);
          if (toggleReviewFormBtn) toggleReviewFormBtn.textContent = "Hide Review Form";
        } else {
          hide(reviewFormWrap);
          if (toggleReviewFormBtn) toggleReviewFormBtn.textContent = ownReview ? "Edit My Review" : "Add My Review";
        }
      });

      q("#btn-proposal-cancel-review-form")?.addEventListener("click", () => {
        hide(reviewFormWrap);
        if (toggleReviewFormBtn) toggleReviewFormBtn.textContent = ownReview ? "Edit My Review" : "Add My Review";
      });

      q("#btn-proposal-save-review")?.addEventListener("click", async () => {
        const statusEl = q("#proposal-review-status");
        const recommendation = q<HTMLSelectElement>("#proposal-review-recommendation")?.value ?? "accept";
        const scoreRaw = q<HTMLInputElement>("#proposal-review-score")?.value.trim() ?? "";
        const reviewerComment = q<HTMLTextAreaElement>("#proposal-review-comment")?.value.trim() ?? "";
        const applicantNote = q<HTMLTextAreaElement>("#proposal-review-applicant-note")?.value.trim() ?? "";
        try {
          if (statusEl) { statusEl.textContent = "Saving…"; statusEl.className = "small text-muted"; }
          await api(`/api/v1/admin/proposals/${proposal.id}/reviews`, {
            method: "POST",
            body: JSON.stringify({
              recommendation,
              score: scoreRaw ? Number(scoreRaw) : undefined,
              reviewerComment: reviewerComment || undefined,
              applicantNote: applicantNote || undefined,
            }),
          });
          if (statusEl) { statusEl.textContent = "Saved"; statusEl.className = "small text-success"; }
          toast("Proposal review saved", "success");
          await loadProposalDetail(slug, proposal, access);
          await loadEventProposals(slug);
        } catch (err) {
          if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
          toast((err as Error).message, "error");
        }
      });

      const reviewScoreEl = q<HTMLInputElement>("#proposal-review-score");
      const reviewScoreValueEl = q("#proposal-review-score-value");
      const syncReviewScoreValue = (): void => {
        const value = reviewScoreEl?.value ?? "5";
        if (reviewScoreValueEl) reviewScoreValueEl.textContent = `${value}/10`;
      };
      reviewScoreEl?.addEventListener("input", syncReviewScoreValue);
      syncReviewScoreValue();

      const finalStatusSelect = q<HTMLSelectElement>("#proposal-final-status");
      const finalizeFormWrap = q("#proposal-finalize-form-wrap");
      const toggleFinalizeFormBtn = q<HTMLButtonElement>("#btn-proposal-toggle-finalize-form");
      const deadlineWrap = q("#proposal-presentation-deadline-wrap");
      const finalConfirm = q<HTMLInputElement>("#proposal-final-confirm");
      const finalizeBtn = q<HTMLButtonElement>("#btn-proposal-finalize");
      const previewFinalizeBtn = q<HTMLButtonElement>("#btn-proposal-preview-finalize");
      const finalizeStatusEl = q("#proposal-finalize-status");

      q("#btn-proposal-toggle-finalize-form")?.addEventListener("click", () => {
        const hidden = finalizeFormWrap?.classList.contains("d-none") ?? true;
        if (hidden) {
          show(finalizeFormWrap);
          if (toggleFinalizeFormBtn) toggleFinalizeFormBtn.textContent = "Hide Finalize Form";
        } else {
          hide(finalizeFormWrap);
          if (toggleFinalizeFormBtn) toggleFinalizeFormBtn.textContent = "Open Finalize Form";
        }
      });

      q("#btn-proposal-cancel-finalize-form")?.addEventListener("click", () => {
        hide(finalizeFormWrap);
        if (toggleFinalizeFormBtn) toggleFinalizeFormBtn.textContent = "Open Finalize Form";
      });

      const syncFinalizeVisibility = (): void => {
        const isAccepted = finalStatusSelect?.value === "accepted";
        if (isAccepted) show(deadlineWrap); else hide(deadlineWrap);
      };

      const syncFinalizeEnabled = (): void => {
        if (finalizeBtn) finalizeBtn.disabled = !(finalConfirm?.checked);
      };

      finalStatusSelect?.addEventListener("change", syncFinalizeVisibility);
      finalConfirm?.addEventListener("change", syncFinalizeEnabled);
      syncFinalizeVisibility();
      syncFinalizeEnabled();

      previewFinalizeBtn?.addEventListener("click", () => {
        const finalStatus = finalStatusSelect?.value ?? "accepted";
        const deadlineRaw = q<HTMLInputElement>("#proposal-presentation-deadline")?.value.trim() ?? "";
        const deadlineLabel = finalStatus === "accepted"
          ? (deadlineRaw ? new Date(deadlineRaw).toLocaleString("en-GB") : "event default / none")
          : "not applicable";
        if (finalizeStatusEl) {
          finalizeStatusEl.textContent = `Preview: status ${finalStatus}, policy reviews enforced, deadline ${deadlineLabel}.`;
          finalizeStatusEl.className = "small text-muted";
        }
      });

      q("#btn-proposal-finalize")?.addEventListener("click", async () => {
        const statusEl = q("#proposal-finalize-status");
        const finalStatus = q<HTMLSelectElement>("#proposal-final-status")?.value ?? "accepted";
        const decisionNote = q<HTMLTextAreaElement>("#proposal-final-note")?.value.trim() ?? "";
        const deadlineRaw = q<HTMLInputElement>("#proposal-presentation-deadline")?.value.trim() ?? "";
        try {
          if (!finalConfirm?.checked) {
            if (statusEl) {
              statusEl.textContent = "Please confirm the final decision checkbox first.";
              statusEl.className = "small text-danger";
            }
            return;
          }

          const ok = window.confirm(
            `Finalize proposal as "${finalStatus}"? This action records a final committee decision and sends decision emails.`,
          );
          if (!ok) return;

          if (statusEl) { statusEl.textContent = "Finalizing…"; statusEl.className = "small text-muted"; }
          await api(`/api/v1/admin/proposals/${proposal.id}/finalize`, {
            method: "POST",
            body: JSON.stringify({
              finalStatus,
              decisionNote: decisionNote || undefined,
              presentationDeadline: finalStatus === "accepted" && deadlineRaw
                ? new Date(deadlineRaw).toISOString()
                : undefined,
            }),
          });
          if (statusEl) { statusEl.textContent = "Finalized"; statusEl.className = "small text-success"; }
          toast("Proposal decision finalized", "success");
          await loadEventProposals(slug);
        } catch (err) {
          if (statusEl) { statusEl.textContent = (err as Error).message; statusEl.className = "small text-danger"; }
          toast((err as Error).message, "error");
        }
      });
    } catch (err) {
      detail.innerHTML = `<div class="alert alert-danger">${esc((err as Error).message)}</div>`;
    }
  }

  return { proposalsGroupTabHtml, wireProposalsGroupTabs, loadEventProposals };
}
