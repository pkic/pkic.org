/**
 * Membership application status-check page.
 *
 * Reached via the token-gated link emailed on submission (see
 * functions/api/v1/members/applications/index.ts statusUrl). Falls back to a
 * manual entry form when reached without a query string — there is no
 * "resend" endpoint for applications, unlike event registrations.
 */
import { render } from "preact";
import { getJson } from "../shared/api-client";
import { setStatus, formatStatusLabel, statusBadgeClass } from "../shared/form/helpers";

const API_BASE_FALLBACK = "/api/v1";

interface ApplicationStatus {
  id: string;
  stage: string;
  stageEnteredAt: string;
  createdAt: string;
}

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

function StatusSummary({ data }: { data: ApplicationStatus }) {
  return (
    <div class="event-flow-success">
      <h2 class="h4">Application status</h2>
      <p>
        <span class={`badge ${statusBadgeClass(data.stage)}`}>{formatStatusLabel(data.stage)}</span>
      </p>
      <p class="text-muted small">
        Submitted {new Date(data.createdAt).toLocaleDateString()} — last updated{" "}
        {new Date(data.stageEnteredAt).toLocaleDateString()}.
      </p>
    </div>
  );
}

async function showStatus(root: HTMLElement, apiBase: string, { id, token }: LookupParams): Promise<void> {
  const lookupForm = root.querySelector<HTMLElement>("[data-lookup-form]");
  const resultContainer = root.querySelector<HTMLElement>("[data-status-result]");
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]");
  if (!resultContainer || !statusEl) return;

  lookupForm?.classList.add("d-none");
  resultContainer.classList.remove("d-none");

  try {
    const data = await getJson<ApplicationStatus>(
      `${apiBase}/members/applications/${encodeURIComponent(id)}/status?token=${encodeURIComponent(token)}`,
    );

    const summaryHost = document.createElement("div");
    resultContainer.textContent = "";
    resultContainer.append(summaryHost);

    render(<StatusSummary data={data} />, summaryHost);
  } catch {
    resultContainer.textContent = "";
    setStatus(
      statusEl,
      "We couldn't find an application matching that ID and token. Please check the link from your confirmation email.",
      true,
    );
    lookupForm?.classList.remove("d-none");
    resultContainer.classList.add("d-none");
  }
}

function wireLookupForm(root: HTMLElement, apiBase: string): void {
  const idInput = root.querySelector<HTMLInputElement>("[data-lookup-id]");
  const tokenInput = root.querySelector<HTMLInputElement>("[data-lookup-token]");
  const submitBtn = root.querySelector<HTMLButtonElement>("[data-lookup-submit]");
  const statusEl = root.querySelector<HTMLElement>("[data-flow-status]");

  submitBtn?.addEventListener("click", () => {
    const id = idInput?.value.trim();
    const token = tokenInput?.value.trim();
    if (!id || !token) {
      if (statusEl) setStatus(statusEl, "Please enter both the application ID and token.", true);
      return;
    }
    void showStatus(root, apiBase, { id, token });
  });
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>("[data-application-status]");
  if (!root) return;
  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;

  wireLookupForm(root, apiBase);

  const params = parseLookupParams(window.location.search);
  if (params) {
    await showStatus(root, apiBase, params);
  }
}

void main();
