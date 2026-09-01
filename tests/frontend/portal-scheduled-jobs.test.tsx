// @vitest-environment jsdom
/**
 * The scheduled-job registry surface: what it reads, what it refuses to
 * reconstruct without the server's say-so, and what it exposes to assistive
 * technology. Split out of portal-system-operations so each file covers one
 * surface rather than the whole Operations shell.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduledJobs } from "../../assets/ts/member-flows/portal/sections/system-operations/ScheduledJobs";
import { runRowAction } from "./helpers/row-actions";
import {
  schedulerJobRunCreateSchema,
  schedulerJobStateUpdateSchema,
  type ScheduledJobResource,
} from "../../assets/shared/schemas/scheduler";

let container: HTMLDivElement | null = null;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function apiError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(label));
  if (!found) throw new Error(`No button labelled ${label}`);
  return found;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function scheduledJob(overrides: Partial<ScheduledJobResource> = {}): ScheduledJobResource {
  return {
    jobKey: "retention",
    intervalSeconds: 86_400,
    nextRunAt: "2026-09-01T00:00:00.000Z",
    wakeRequested: false,
    lastRunAt: null,
    lastSuccessAt: null,
    lastStatus: null,
    lastError: null,
    lastDurationMs: null,
    consecutiveFailures: 0,
    consecutiveAbandoned: 0,
    runningSince: null,
    leaseExpiresAt: null,
    pausedAt: null,
    pausedReason: null,
    leaseExpired: false,
    capabilities: { manageState: false, run: false },
    ...overrides,
  };
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("portal scheduled-job management", () => {
  it("renders the bounded registry without reconstructing server-denied actions", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        requests.push(`${method} ${url.pathname}`);
        if (url.pathname === "/api/v1/scheduler/jobs") return json({ jobs: [scheduledJob()] });
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ScheduledJobs />, container!));
    await settle();

    expect(container.textContent).toContain("Retention");
    expect(container.textContent).toContain("1 day");
    expect(container.textContent).not.toContain("Run now");
    expect(container.textContent).not.toContain("Pause");
    expect(container.textContent).not.toContain("Resume");
    // The registry names itself for anyone listing the tables on the page.
    expect(container.querySelector("caption")?.textContent).toBe("Scheduled jobs");
    expect(requests).toEqual(["GET /api/v1/scheduler/jobs"]);
  });

  it("announces a load failure instead of showing an empty registry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => apiError(403, "FORBIDDEN", "Scheduler access is not assigned to this account.")),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ScheduledJobs />, container!));
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Scheduler access is not assigned to this account.");
    expect(container.querySelector("table")).toBeNull();
  });

  it("shows a named empty state rather than a bare table when no job is registered", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ jobs: [] })),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ScheduledJobs />, container!));
    await settle();

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("No scheduled jobs are configured.");
  });

  it("uses the canonical state resource and runs collection for server-authorized controls", async () => {
    const requests: Array<{ method: string; path: string; body: unknown }> = [];
    let current = scheduledJob({ capabilities: { manageState: true, run: true } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? (input instanceof Request ? input.method : "GET");
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
        requests.push({ method, path: url.pathname, body });
        if (url.pathname === "/api/v1/scheduler/jobs" && method === "GET") return json({ jobs: [current] });
        if (url.pathname === "/api/v1/scheduler/jobs/retention" && method === "PATCH") {
          const state = (body as { state: "active" | "paused" }).state;
          current = scheduledJob({
            capabilities: { manageState: true, run: true },
            pausedAt: state === "paused" ? "2026-08-30T00:00:00.000Z" : null,
            pausedReason: state === "paused" ? (body as { reason: string }).reason : null,
          });
          return json({ success: true, job: current });
        }
        if (url.pathname === "/api/v1/scheduler/jobs/retention/runs" && method === "POST") {
          current = scheduledJob({
            capabilities: { manageState: true, run: true },
            lastRunAt: "2026-08-30T00:00:01.000Z",
            lastSuccessAt: "2026-08-30T00:00:01.000Z",
            lastStatus: "succeeded",
            lastDurationMs: 12,
          });
          return json({ success: true, jobKey: "retention", status: "succeeded", durationMs: 12 });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ScheduledJobs />, container!));
    await settle();

    // Row commands live behind the row's menu, named after the job.
    await runRowAction(container, "Retention", "Pause");

    // The reason is a labelled control: the label's `for` resolves to the
    // textarea's own id, and its guidance is wired through aria-describedby.
    const reasonLabel = [...container.querySelectorAll("label")].find((label) =>
      label.textContent?.startsWith("Pause reason"),
    )!;
    const reason = document.getElementById(reasonLabel.htmlFor) as HTMLTextAreaElement;
    expect(reason.tagName).toBe("TEXTAREA");
    expect(reason.id).toBe(reasonLabel.htmlFor);
    expect(document.getElementById(reason.getAttribute("aria-describedby")!)?.textContent).toContain(
      "Recorded with the pause",
    );
    expect(reason.getAttribute("aria-invalid")).toBeNull();

    // A reason the endpoint would reject is announced before submission, and
    // the submit control stays inert.
    await act(() => {
      reason.value = "ab";
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(reason.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Give at least 3 characters.");
    expect(button(container, "Confirm pause").disabled).toBe(true);

    await act(() => {
      reason.value = "investigating delivery failures";
      reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => button(container!, "Confirm pause").click());
    await settle();

    await runRowAction(container, "Retention", "Resume");
    await settle();
    await runRowAction(container, "Retention", "Run now");
    for (let attempt = 0; attempt < 3; attempt += 1) await settle();

    // Each command body is read back through the shared request contract, so
    // a shape the endpoint would refuse fails here rather than in production.
    const patches = requests
      .filter(({ method, path }) => method === "PATCH" && path === "/api/v1/scheduler/jobs/retention")
      .map(({ body }) => schedulerJobStateUpdateSchema.parse(body));
    expect(patches).toEqual([{ state: "paused", reason: "investigating delivery failures" }, { state: "active" }]);
    const runs = requests.filter(({ method, path }) => method === "POST" && path.endsWith("/runs"));
    expect(runs).toHaveLength(1);
    expect(schedulerJobRunCreateSchema.parse(runs[0].body)).toEqual({});
    expect(requests.some(({ path }) => path.endsWith("/pause") || path.endsWith("/resume"))).toBe(false);
    expect(container.textContent).toContain("Succeeded");
  });
});
