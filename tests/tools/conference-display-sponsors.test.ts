import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { collectDocumentSponsorSelections } from "../../functions/_lib/services/site-sponsor-selections";
import { parseFrontMatter } from "../../functions/_lib/services/site-markdown";
import type { ContentDocument } from "../../functions/_lib/services/site-documents";

it("exports kiosk sponsors only when the conference authors enable that display", async () => {
  const sourcePath = "content/events/2025/pqc-conference-kuala-lumpur-my/_index.md";
  const source = parseFrontMatter(await readFile(sourcePath, "utf8"));
  const document: ContentDocument = {
    ...source,
    sourcePath,
    nodePath: "events/2025/pqc-conference-kuala-lumpur-my",
    route: "/events/2025/pqc-conference-kuala-lumpur-my/",
    language: "en",
    isSection: true,
  };
  const displaySelection = { mode: "strip", eventName: String(source.data.params?.sponsoring), minWeight: "4" };
  expect(collectDocumentSponsorSelections([document], () => ({}))).toContainEqual(displaySelection);
  const withoutDisplay = { ...document, data: { ...document.data, outputs: ["html", "event-data"] } };
  expect(collectDocumentSponsorSelections([withoutDisplay], () => ({}))).not.toContainEqual(displaySelection);
});
