import "./TaxonomyPage.css";
import type { SiteTaxonomy } from "../../shared/site-content";
import { SiteListingSection } from "./SitePrimitives";
import { siteContentLanguageForPath, siteContentLanguagePrefix } from "../../shared/site-content-language";

/** Author, tag, and series archives reuse the canonical blog listing. */
export function TaxonomyPage({ taxonomy }: { taxonomy: SiteTaxonomy }) {
  const languagePrefix = siteContentLanguagePrefix(siteContentLanguageForPath(taxonomy.basePath));
  return (
    <>
      <section class="pk pk-center blog-taxonomy-header">
        <div class="pk-container pk-container--narrow pk-stack pk-stack--snug">
          <h1>{taxonomy.heading}</h1>
          <p class="pk-lede">
            {taxonomy.term ? (
              <>
                Posts by <a href={`${languagePrefix}/${taxonomy.plural}/`}>{taxonomy.singular}</a>{" "}
                <strong>{taxonomy.term}</strong>
              </>
            ) : (
              <>
                Posts by <strong>{taxonomy.singular}</strong>, back to <a href={`${languagePrefix}/blog/`}>blog</a>
              </>
            )}
          </p>
        </div>
      </section>
      <div class="blog-taxonomy-body">
        <div class="pk-container pk-stack pk-stack--loose">
          {taxonomy.terms?.length ? (
            <ul class="blog-taxonomy-index">
              {taxonomy.terms.map((entry) => (
                <li key={entry.href}>
                  <a href={entry.href}>
                    {entry.label} <span class="pk-badge pk-badge--neutral">{entry.count}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          {taxonomy.term ? (
            <SiteListingSection
              listing={{
                basePath: taxonomy.basePath,
                heading: `Posts by ${taxonomy.term}`,
                items: taxonomy.posts ?? [],
                kind: "blog",
                page: taxonomy.page,
                pageCount: taxonomy.pageCount,
              }}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}
