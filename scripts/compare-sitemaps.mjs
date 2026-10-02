import { writeFile } from "node:fs/promises";
import { compareSitemapUrls, readSitemapUrls } from "./publication/sitemap-comparison.mjs";

const [baselineUrl, candidateUrl, output] = process.argv.slice(2);
if (!baselineUrl || !candidateUrl) {
  throw new Error(
    "Usage: pnpm exec node scripts/compare-sitemaps.mjs BASELINE_SITEMAP CANDIDATE_SITEMAP [REPORT_JSON]",
  );
}
const [baseline, candidate] = await Promise.all([readSitemapUrls(baselineUrl), readSitemapUrls(candidateUrl)]);
const report = { baselineUrl, candidateUrl, ...compareSitemapUrls(baseline, candidate) };
if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.missing.length || baseline.duplicates.length || candidate.duplicates.length) process.exitCode = 1;
