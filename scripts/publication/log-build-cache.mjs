import { readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

/** Observe the standard Astro cache without altering its contents or ownership. */
export async function logPublicationBuildCache(stage, cacheDirectory = "node_modules/.astro") {
  const started = performance.now();
  const groups = ["assets", "publication-social", "publication-diagrams"];
  const summaries = await Promise.all(
    groups.map(async (group) => {
      const directory = resolve(cacheDirectory, group);
      try {
        const entries = await readdir(directory, { withFileTypes: true });
        const files = entries.filter((entry) => entry.isFile());
        const sizes = await Promise.all(files.map((entry) => stat(resolve(directory, entry.name))));
        const bytes = sizes.reduce((total, file) => total + file.size, 0);
        return `${group}: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB`;
      } catch (error) {
        if (error.code === "ENOENT") return `${group}: missing`;
        return `${group}: unavailable (${error.code ?? "read error"})`;
      }
    }),
  );
  console.log(
    `[publication] build cache ${stage}: ${cacheDirectory}; ${summaries.join("; ")} (inspection ${(performance.now() - started).toFixed(0)} ms)`,
  );
}
