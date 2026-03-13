function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

export function applyCampaignCustomText(
  templateContent: string,
  contentType: "markdown" | "html" | "text",
  customText: string | null | undefined,
): string {
  const text = (customText ?? "").trim();
  const removeMessageTag = (content: string): string =>
    content
      .replace(/\{\{\{\s*message\s*\}\}\}/g, "")
      .replace(/\{\{\s*message\s*\}\}/g, "");

  if (!text) return removeMessageTag(templateContent);

  if (contentType === "html") {
    const safe = escapeHtml(text).replace(/\n/g, "<br>\n");
    return templateContent
      .replace(/\{\{\{\s*message\s*\}\}\}/g, safe)
      .replace(/\{\{\s*message\s*\}\}/g, safe);
  }

  return templateContent
    .replace(/\{\{\{\s*message\s*\}\}\}/g, text)
    .replace(/\{\{\s*message\s*\}\}/g, text);
}
