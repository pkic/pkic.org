/**
 * Refreshes the vendored email-domain lists in
 * `functions/_lib/email-domains/generated/`:
 *
 *   free-email-domains.ts        free and shared mailbox providers, ISPs included
 *   disposable-email-domains.ts  throwaway mailbox providers
 *   public-suffix-rules.ts       the Public Suffix List, ICANN and private sections
 *   provenance.json              source, commit, counts and license of each
 *
 * Each source is pinned to the commit its default branch points at when the
 * script runs, so the provenance names exactly what was vendored. The Worker
 * never fetches these lists; review the diff and commit it like code.
 *
 *   pnpm run refresh:email-domains
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEmailDomainLists,
  parseDomainLines,
  renderDomainDataModule,
} from "./lib/email-domain-lists.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "functions/_lib/email-domains/generated");

const SOURCES = {
  free: {
    repository: "Kikobeats/free-email-domains",
    branch: "master",
    file: "domains.json",
    license: "MIT",
    licenseFile: "LICENSE.md",
    note: "Free and shared mailbox providers, ISPs included, derived from HubSpot's list of free email domains.",
  },
  disposable: {
    repository: "disposable-email-domains/disposable-email-domains",
    branch: "main",
    file: "disposable_email_blocklist.conf",
    license: "CC0-1.0",
    licenseFile: "LICENSE.txt",
    note: "Disposable and temporary mailbox providers.",
  },
  publicSuffix: {
    repository: "publicsuffix/list",
    branch: "main",
    file: "public_suffix_list.dat",
    license: "MPL-2.0",
    licenseFile: "LICENSE",
    note: "The Public Suffix List (https://publicsuffix.org/list/), ICANN and private sections.",
  },
};

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

async function fetchOk(url, accept) {
  const response = await fetch(url, { headers: { accept, "user-agent": "pkic-email-domain-refresh" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response;
}

/** The commit the branch points at now, and the source file at exactly that commit. */
async function download(source) {
  const commit = await (
    await fetchOk(`${API}/repos/${source.repository}/commits/${source.branch}`, "application/vnd.github+json")
  ).json();
  const url = `${RAW}/${source.repository}/${commit.sha}/${source.file}`;
  const text = await (await fetchOk(url, "text/plain")).text();
  return {
    text,
    provenance: {
      repository: `https://github.com/${source.repository}`,
      file: source.file,
      commit: commit.sha,
      committedAt: commit.commit.committer.date,
      url,
      license: source.license,
      licenseUrl: `${RAW}/${source.repository}/${commit.sha}/${source.licenseFile}`,
      note: source.note,
    },
  };
}

const [free, disposable, publicSuffix] = await Promise.all([
  download(SOURCES.free),
  download(SOURCES.disposable),
  download(SOURCES.publicSuffix),
]);

const lists = buildEmailDomainLists({
  freeEntries: JSON.parse(free.text),
  disposableEntries: parseDomainLines(disposable.text),
  publicSuffixText: publicSuffix.text,
});

const modules = [
  {
    file: "free-email-domains.ts",
    constName: "FREE_EMAIL_DOMAINS",
    summary: "Free and shared mailbox providers, ISPs included; disposable providers are listed separately.",
    entries: lists.free.domains,
    source: { repository: SOURCES.free.repository, commit: free.provenance.commit, license: SOURCES.free.license },
  },
  {
    file: "disposable-email-domains.ts",
    constName: "DISPOSABLE_EMAIL_DOMAINS",
    summary: "Disposable and temporary mailbox providers.",
    entries: lists.disposable.domains,
    source: { repository: SOURCES.disposable.repository, commit: disposable.provenance.commit, license: SOURCES.disposable.license },
  },
  {
    file: "public-suffix-rules.ts",
    constName: "PUBLIC_SUFFIX_RULES",
    summary: "Public Suffix List rules in punycode, with their `*.` and `!` prefixes.",
    entries: lists.publicSuffix.rules,
    source: { repository: SOURCES.publicSuffix.repository, commit: publicSuffix.provenance.commit, license: SOURCES.publicSuffix.license },
  },
];

const provenance = {
  retrievedAt: new Date().toISOString(),
  free: {
    ...free.provenance,
    upstreamEntries: lists.free.upstream,
    entries: lists.free.domains.length,
    excluded: "Entries also on the disposable list, and entries that are or contain a public suffix.",
    droppedAsPublicSuffix: lists.free.dropped,
    invalid: lists.free.invalid,
  },
  disposable: {
    ...disposable.provenance,
    upstreamEntries: lists.disposable.upstream,
    entries: lists.disposable.domains.length,
    droppedAsPublicSuffix: lists.disposable.dropped,
    invalid: lists.disposable.invalid,
  },
  publicSuffix: {
    ...publicSuffix.provenance,
    rules: lists.publicSuffix.rules.length,
    icannRules: lists.publicSuffix.counts.icann,
    privateRules: lists.publicSuffix.counts.private,
  },
};

mkdirSync(outDir, { recursive: true });
for (const module of modules) writeFileSync(resolve(outDir, module.file), renderDomainDataModule(module));
writeFileSync(resolve(outDir, "provenance.json"), `${JSON.stringify(provenance, null, 2)}\n`);
console.log(
  `[refresh-email-domains] ${lists.free.domains.length} free, ${lists.disposable.domains.length} disposable, ` +
    `${lists.publicSuffix.rules.length} public suffix rules → ${relative(root, outDir)}`,
);
