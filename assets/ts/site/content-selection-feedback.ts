import { contentContributionSchema, contentFeedbackUrl } from "../../shared/content-contribution";

/** Capture selected authored content without including site navigation or footer text. */
export function selectedContentFeedbackUrl(document: Document, selection: Selection, page: string): string | undefined {
  const metadata = document.querySelector<HTMLElement>("[data-content-contribution]");
  if (!metadata) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(metadata.dataset.contentContribution ?? "");
  } catch {
    return undefined;
  }
  const parsed = contentContributionSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.sourcePath || !selection.anchorNode || !selection.focusNode) return undefined;
  const anchor = selection.getRangeAt(0).startContainer;
  const element = anchor instanceof Element ? anchor : anchor.parentElement;
  const body = element?.closest("[data-pagefind-body]");
  if (!body?.contains(selection.anchorNode) || !body.contains(selection.focusNode)) return undefined;
  const identified = element?.closest<HTMLElement>("[data-content-item-id]");
  const headings = [...body.querySelectorAll<HTMLElement>("h2[id], h3[id], h4[id], h5[id]")];
  const heading =
    element?.closest<HTMLElement>("h2[id], h3[id], h4[id], h5[id]") ??
    headings
      .reverse()
      .find((entry) => Boolean(entry.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING));
  const item = identified?.dataset.contentItemId ?? heading?.dataset.contentItemId ?? heading?.id ?? "";
  const url = new URL(page);
  if (heading) url.hash = heading.id;
  return contentFeedbackUrl(parsed.data, url.href, selection.toString().trim(), item);
}
