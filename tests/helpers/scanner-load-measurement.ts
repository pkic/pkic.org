import { z } from "zod";

const controlSchema = z.object({
  workload: z.enum(["legacy", "eligibility", "admission", "attendance", "mixed"]),
  concurrency: z.coerce.number().int().min(1).max(64),
  rate: z.coerce.number().int().min(1).max(10000).nullable(),
});

/** Test-only workload controls are not approved pilot targets. */
export function scannerLoadControls(bindings: object) {
  const rate = Reflect.get(bindings, "PKIC_SCANNER_BENCHMARK_RATE");
  const controls = controlSchema.parse({
    workload: Reflect.get(bindings, "PKIC_SCANNER_BENCHMARK_WORKLOAD") ?? "legacy",
    concurrency: Reflect.get(bindings, "PKIC_SCANNER_BENCHMARK_CONCURRENCY") ?? "32",
    rate: rate === undefined || rate === "" ? null : rate,
  });
  if (
    controls.workload !== "legacy" &&
    (Reflect.get(bindings, "PKIC_SCANNER_BENCHMARK_MODE") !== "mounted" || controls.rate === null)
  )
    throw new Error("Controlled scanner workloads require mounted mode and an explicit offered rate");
  return controls;
}

type Sample = {
  scheduledAt: number;
  enqueuedAt: number;
  startedAt: number;
  finishedAt: number;
  operation: string;
  outcome: string;
  status: number;
  bytes: number;
};
export type ScannerLoadResult = Pick<Sample, "operation" | "outcome" | "status" | "bytes">;
const rounded = (value: number) => Number(value.toFixed(2));
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => rounded(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0);
  return {
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: rounded(sorted.at(-1) ?? 0),
  };
}

/** One producer emits independently of worker completion, exposing queueing under saturation. */
export async function measureScannerLoad<T>(
  items: readonly T[],
  controls: { concurrency: number; rate: number },
  execute: (item: T) => Promise<ScannerLoadResult>,
  operation: (item: T) => string,
) {
  // Reserve setup/drain headroom within the existing 120s test budget, without changing it.
  if (items.length / controls.rate > 60)
    throw new Error("Choose an offered rate whose scheduled workload fits within 60 seconds");
  const samples: Sample[] = [];
  const queue: { item: T; scheduledAt: number; enqueuedAt: number }[] = [];
  let head = 0,
    offered = 0,
    completed = 0,
    inFlight = 0,
    peakQueued = 0,
    peakInFlight = 0;
  let producing = true;
  let wake!: () => void;
  let changed = new Promise<void>((resolve) => {
    wake = resolve;
  });
  function signal() {
    wake();
    changed = new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
  const start = performance.now();
  const backlog: { elapsedMs: number; offered: number; completed: number; queued: number; inFlight: number }[] = [];
  const observe = () =>
    backlog.push({
      elapsedMs: rounded(performance.now() - start),
      offered,
      completed,
      queued: queue.length - head,
      inFlight,
    });
  const workers = Array.from({ length: controls.concurrency }, async () => {
    while (producing || head < queue.length) {
      if (head >= queue.length) {
        await changed;
        continue;
      }
      const { item, scheduledAt, enqueuedAt } = queue[head++];
      const startedAt = performance.now();
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      let result: ScannerLoadResult;
      try {
        result = await execute(item);
      } catch {
        // Reports intentionally contain no failed request, credential, contact, or raw response.
        result = { operation: operation(item), outcome: "unexpected_error", status: 0, bytes: 0 };
      }
      samples.push({ ...result, scheduledAt, enqueuedAt, startedAt, finishedAt: performance.now() });
      inFlight--;
      completed++;
      if (completed % Math.max(1, Math.ceil(items.length / 10)) === 0) observe();
    }
  });
  for (let index = 0; index < items.length; index++) {
    const scheduledAt = start + (index * 1000) / controls.rate;
    while (performance.now() < scheduledAt)
      await new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, scheduledAt - performance.now())));
    queue.push({ item: items[index], scheduledAt, enqueuedAt: performance.now() });
    offered++;
    peakQueued = Math.max(peakQueued, queue.length - head);
    signal();
  }
  const offeredFinishedAt = performance.now();
  producing = false;
  observe();
  signal();
  await Promise.all(workers);
  observe();
  const completedAt = performance.now();
  const elapsedMs = completedAt - start;
  const groups = new Map<string, Sample[]>();
  for (const sample of samples) {
    const key = `${sample.operation}:${sample.outcome}:${sample.status}`;
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
  return {
    offeredRatePerSecond: controls.rate,
    concurrency: controls.concurrency,
    offered,
    completed,
    unexpectedErrors: samples.filter((sample) => sample.outcome === "unexpected_error").length,
    elapsedMs: rounded(elapsedMs),
    offeredElapsedMs: rounded(offeredFinishedAt - start),
    completedPerSecond: elapsedMs > 0 ? rounded((completed * 1000) / elapsedMs) : null,
    drainAfterLastOfferMs: rounded(completedAt - offeredFinishedAt),
    backlog: { peakQueued, peakInFlight, finalPending: offered - completed, samples: backlog },
    requestLatency: distribution(samples.map((sample) => sample.finishedAt - sample.startedAt)),
    queueLatency: distribution(samples.map((sample) => sample.startedAt - sample.enqueuedAt)),
    schedulingLag: distribution(samples.map((sample) => sample.enqueuedAt - sample.scheduledAt)),
    scheduledToReceiptLatency: distribution(samples.map((sample) => sample.finishedAt - sample.scheduledAt)),
    phases: [...groups].map(([key, group]) => ({
      key,
      count: group.length,
      responseBytes: group.reduce((total, sample) => total + sample.bytes, 0),
      requestLatency: distribution(group.map((sample) => sample.finishedAt - sample.startedAt)),
      queueLatency: distribution(group.map((sample) => sample.startedAt - sample.enqueuedAt)),
      schedulingLag: distribution(group.map((sample) => sample.enqueuedAt - sample.scheduledAt)),
      scheduledToReceiptLatency: distribution(group.map((sample) => sample.finishedAt - sample.scheduledAt)),
    })),
  };
}
