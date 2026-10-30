import { MembershipWorkflowProgress } from "../components/MembershipWorkflowProgress";
/**
 * Membership application status-check page.
 *
 * Reached via the token-gated link emailed on submission (see
 * functions/api/v1/members/applications/index.ts statusUrl). Incomplete links
 * show email guidance without asking applicants to copy secrets.
 */
import { render } from "preact";
import { ApiClientError, getJson } from "../shared/api-client";
import { formatDate } from "../shared/ui";
import { setStatus } from "../shared/form/helpers";
import { Badge } from "../components/Badge";
import { ButtonLink } from "../ui/Button";
import { DescriptionList } from "../ui/DescriptionList";
import { SectionHeading } from "../ui/SectionHeading";
import { applicationStageNextStep } from "../../shared/membership-application-next-steps";
import {
  memberApplicationStatusResponseSchema,
  type MemberApplicationStatusResponse,
} from "../../shared/schemas/member-applications";

const API_BASE_FALLBACK = "/api/v1";

type ApplicationStatus = MemberApplicationStatusResponse;

export interface LookupParams {
  id: string;
  token: string;
}

/** Reads {id, token} from a query string; returns null if either is missing. */
export function parseLookupParams(search: string): LookupParams | null {
  const params = new URLSearchParams(search);
  const id = params.get("id")?.trim();
  const token = params.get("token")?.trim();
  if (!id || !token) return null;
  return { id, token };
}

/** Exported so the rendered summary can be asserted on without the page. */
export function StatusSummary({ data }: { data: ApplicationStatus }) {
  const category = data.membershipCategoryLabel
    ? `${data.membershipCategory} — ${data.membershipCategoryLabel}`
    : data.membershipCategory;
  return (
    <div class="pk pk-stack">
      <h2>Application status</h2>
      <DescriptionList
        items={[
          // The requirements panel carries the status itself when there is one.
          ...(data.workflow ? [] : [{ term: "Status", value: <Badge status={data.stage} /> }]),
          { term: "Eligibility category", value: category },
          { term: "Submitted", value: formatDate(data.createdAt) },
          { term: "Last updated", value: formatDate(data.stageEnteredAt) },
        ]}
      />
      <section class="pk-stack pk-stack--snug" aria-labelledby="application-next-step">
        <SectionHeading id="application-next-step" level={3}>
          What happens next
        </SectionHeading>
        <p>{applicationStageNextStep(data.stage)}</p>
        {data.stage === "approved" && (
          <div class="pk-cluster">
            <ButtonLink variant="primary" href="/portal/">
              Sign in to the member portal
            </ButtonLink>
          </div>
        )}
      </section>
      {data.workflow && <MembershipWorkflowProgress progress={data.workflow} />}
      <p class="pk-small">
        Questions about your application? <a href="/contact/">Contact the membership team</a>.
      </p>
    </div>
  );
}

async function showStatus(root: HTMLElement, apiBase: string, { id, token }: LookupParams): Promise<void> {
  const linkHelp = root.querySelector<HTMLElement>("[data-link-help]");
  const retry = root.querySelector<HTMLElement>("[data-status-retry]");
  const resultContainer = root.querySelector<HTMLElement>("[data-status-result]");
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]");
  if (!resultContainer || !statusEl) return;

  if (linkHelp) linkHelp.hidden = true;
  if (retry) retry.hidden = true;
  statusEl.hidden = true;
  resultContainer.hidden = false;

  try {
    const data = await getJson(
      `${apiBase}/members/applications/${encodeURIComponent(id)}/status?token=${encodeURIComponent(token)}`,
      memberApplicationStatusResponseSchema,
    );

    const summaryHost = document.createElement("div");
    resultContainer.textContent = "";
    resultContainer.append(summaryHost);

    render(<StatusSummary data={data} />, summaryHost);
  } catch (error) {
    const transient =
      error instanceof ApiClientError && (error.status === 0 || error.status === 429 || error.status >= 500);
    resultContainer.textContent = "";
    setStatus(
      statusEl,
      transient
        ? "Application status is temporarily unavailable. Please try again shortly."
        : "This status link is incomplete, invalid, or expired. Please open the link from your confirmation email or a more recent update.",
      true,
    );
    if (linkHelp) linkHelp.hidden = transient;
    if (retry) retry.hidden = !transient;
    resultContainer.hidden = true;
  }
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-application-status]");
  if (!root) return;
  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;

  const params = parseLookupParams(window.location.search);
  if (params) {
    root
      .querySelector("[data-status-retry] button")
      ?.addEventListener("click", () => void showStatus(root, apiBase, params));
    await showStatus(root, apiBase, params);
  }
}

void main();
