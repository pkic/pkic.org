import {
  memberNewsPageSchema,
  memberNewsQuerySchema,
  type MemberNewsArticle,
} from "../assets/shared/schemas/member-news";
import { buildPageInfo } from "../assets/shared/schemas/pagination";

export const newsPageSize = memberNewsQuerySchema.parse({}).limit;
export const newsPageHref = (offset: number) => (offset === 0 ? "/news/" : `/news/page/${offset / newsPageSize + 1}/`);

/** Pagination is resolved during publication, using the canonical page contract. */
export function publishedNewsPages(articles: MemberNewsArticle[]) {
  return Array.from({ length: Math.max(1, Math.ceil(articles.length / newsPageSize)) }, (_, index) => {
    const offset = index * newsPageSize;
    const selected = articles.slice(offset, offset + newsPageSize);
    return {
      route: newsPageHref(offset),
      query: memberNewsQuerySchema.parse({ limit: newsPageSize, offset }),
      page: memberNewsPageSchema.parse({
        articles: selected,
        page: buildPageInfo(newsPageSize, offset, articles.length, selected.length),
      }),
    };
  });
}
