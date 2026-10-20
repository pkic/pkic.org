import { modelContributionSchema, modelFeedbackUrl } from "../../shared/model-contribution";

/** Return contextual feedback for registered model pages; leave other edit links alone. */
export function selectedModelFeedbackUrl(document: Document, selection: Selection, page: string): string | undefined {
  const metadata = document.querySelector<HTMLElement>("[data-model-contribution]");
  if (!metadata) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(metadata.dataset.modelContribution ?? "");
  } catch {
    return undefined;
  }
  const parsed = modelContributionSchema.safeParse(raw);
  if (!parsed.success || !selection.anchorNode || !selection.focusNode) return undefined;
  const body = document.querySelector("[data-pagefind-body]");
  if (!body?.contains(selection.anchorNode) || !body.contains(selection.focusNode)) return undefined;
  const anchor = selection.getRangeAt(0).startContainer;
  const element = anchor instanceof Element ? anchor : anchor.parentElement;
  const identified = element?.closest<HTMLElement>("[data-model-item-id]");
  const headings = [...body.querySelectorAll<HTMLElement>("h2[id], h3[id], h4[id], h5[id]")];
  const heading =
    element?.closest<HTMLElement>("h2[id], h3[id], h4[id], h5[id]") ??
    headings
      .reverse()
      .find((entry) => Boolean(entry.compareDocumentPosition(anchor) & Node.DOCUMENT_POSITION_FOLLOWING));
  const item = identified?.dataset.modelItemId ?? heading?.id ?? "";
  const url = new URL(page);
  if (heading) url.hash = heading.id;
  return modelFeedbackUrl(parsed.data, url.href, selection.toString().trim(), item);
}
