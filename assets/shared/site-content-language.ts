export const SITE_CONTENT_LANGUAGES = ["en", "ms"] as const;
export type SiteContentLanguage = (typeof SITE_CONTENT_LANGUAGES)[number];

export function siteContentLanguagePrefix(language: SiteContentLanguage): string {
  return language === "en" ? "" : `/${language}`;
}

export function siteContentLanguageForPath(path: string): SiteContentLanguage {
  return (
    SITE_CONTENT_LANGUAGES.find(
      (language) => language !== "en" && (path === `/${language}` || path.startsWith(`/${language}/`)),
    ) ?? "en"
  );
}
