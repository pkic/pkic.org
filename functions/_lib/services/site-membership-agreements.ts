import type { SiteContentPage } from "../../../assets/shared/site-content";
import type { MembershipDocument } from "../../../assets/ts/site/JoinFlow";
import { inlineMarkdownHtml } from "./site-components";

/** Compose the complete authored documents shown before membership acceptance. */
export async function readMembershipAgreementDocuments(
  loadPage: (href: string) => Promise<SiteContentPage | null>,
  childRoutes: (href: string) => string[],
): Promise<MembershipDocument[]> {
  return Promise.all(
    [
      { key: "agrees_bylaws", href: "/bylaws/" },
      { key: "agrees_code_of_conduct", href: "/code-of-conduct/" },
      { key: "agrees_ipr_policy", href: "/ipr/" },
    ].map(async ({ key, href }) => {
      const page = await loadPage(href);
      if (!page) throw new Error(`Membership legal document is missing: ${href}`);
      const children = await Promise.all(
        childRoutes(href).map(async (route) => {
          const child = await loadPage(route);
          if (!child) throw new Error(`Membership legal document is missing: ${route}`);
          return `<h3>${await inlineMarkdownHtml(child.title)}</h3>${child.html}`;
        }),
      );
      return { key, href, title: page.title, html: children.join("") + page.html };
    }),
  );
}
