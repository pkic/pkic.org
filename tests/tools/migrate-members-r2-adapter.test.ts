import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { parseArgs } from "../../scripts/migrate-members/cli.mjs";
import { runWithConcurrency, uploadLogosToR2 } from "../../scripts/migrate-members/r2-adapter.mjs";

function uploads(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    filePath: `/fixtures/logo-${index}.png`,
    r2Key: `org-logos/org-${index}/logo.png`,
  }));
}

describe("member migration R2 upload batch", () => {
  it("uses a conservative default and accepts an explicit concurrency", () => {
    expect(parseArgs(["--dry-run"], "/workspace").logoConcurrency).toBe(4);
    expect(parseArgs(["--dry-run", "--logo-concurrency", "8"], "/workspace").logoConcurrency).toBe(8);
  });

  it("runs local uploads through one platform proxy with a fixed bound", async () => {
    let active = 0;
    let maximumActive = 0;
    let disposed = false;
    let proxyStarts = 0;
    let proxyOptions: Record<string, unknown> | undefined;
    let generatedBucketName: string | undefined;
    const puts: Array<{ key: string; value: string }> = [];

    await uploadLogosToR2(
      "/workspace",
      { wranglerFlag: "--local", wranglerEnv: "local" },
      {
        logoBucket: "pkic-assets",
        logoConcurrency: 3,
        persistTo: "/state",
      },
      uploads(8),
      {
        getPlatformProxy: async (options: { configPath: string }) => {
          proxyStarts += 1;
          proxyOptions = options;
          generatedBucketName = JSON.parse(await readFile(options.configPath, "utf8")).r2_buckets[0].bucket_name;
          return {
            env: {
              ASSETS_BUCKET: {
                put: async (key: string, value: Uint8Array) => {
                  active += 1;
                  maximumActive = Math.max(maximumActive, active);
                  await new Promise((resolve) => setTimeout(resolve, 5));
                  puts.push({ key, value: new TextDecoder().decode(value) });
                  active -= 1;
                },
              },
            },
            dispose: async () => {
              disposed = true;
            },
          };
        },
        readFile: async (filePath: string) => new TextEncoder().encode(filePath),
      },
    );

    expect(proxyStarts).toBe(1);
    expect(puts).toHaveLength(8);
    expect(maximumActive).toBe(3);
    expect(puts).toContainEqual({
      key: "org-logos/org-0/logo.png",
      value: "/fixtures/logo-0.png",
    });
    expect(generatedBucketName).toBe("pkic-assets");
    expect(proxyOptions).toMatchObject({
      persist: { path: "/state/v3" },
      remoteBindings: false,
    });
    expect(disposed).toBe(true);
  });

  it("forwards remote mode without local persistence", async () => {
    const calls: string[][] = [];

    await uploadLogosToR2(
      "/workspace",
      { wranglerFlag: "--remote", wranglerEnv: "preview" },
      {
        logoBucket: "pkic-assets-preview",
        logoConcurrency: 2,
        persistTo: "/state",
      },
      uploads(1),
      {
        runCommand: async (_command: string, args: string[]) => {
          calls.push(args);
        },
      },
    );

    expect(calls[0]).toContain("--remote");
    expect(calls[0]).not.toContain("--persist-to=/state");
  });

  it("stops scheduling new uploads after a failure and waits for in-flight work", async () => {
    const started: number[] = [];
    let inFlightFinished = false;

    await expect(
      runWithConcurrency([0, 1, 2, 3], 2, async (index: number) => {
        started.push(index);
        if (index === 0) throw new Error("upload failed");
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlightFinished = true;
      }),
    ).rejects.toThrow("upload failed");

    expect(started).toEqual([0, 1]);
    expect(inFlightFinished).toBe(true);
  });

  it("rejects invalid concurrency", async () => {
    await expect(runWithConcurrency(uploads(1), 0, async () => {})).rejects.toThrow(
      "Upload concurrency must be a positive integer",
    );
  });
});
