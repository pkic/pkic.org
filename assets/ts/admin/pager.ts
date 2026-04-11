export const ADMIN_LIST_PAGE_SIZE_DEFAULT = 50;
export const ADMIN_LIST_PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export function pagerRangeText(offset: number, rowCount: number, total: number): string {
  if (total <= 0 || rowCount <= 0) {
    return "Records 0-0 of 0";
  }
  const start = offset + 1;
  const end = offset + rowCount;
  return `Records ${start}-${end} of ${total}`;
}

export function visiblePagerItems(currentPage: number, maxPage: number): Array<number | "ellipsis"> {
  if (maxPage <= 7) {
    return Array.from({ length: maxPage }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, maxPage, currentPage - 1, currentPage, currentPage + 1]);

  if (currentPage <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }

  if (currentPage >= maxPage - 2) {
    pages.add(maxPage - 1);
    pages.add(maxPage - 2);
    pages.add(maxPage - 3);
  }

  const sortedPages = Array.from(pages)
    .filter((page) => page >= 1 && page <= maxPage)
    .sort((left, right) => left - right);

  const items: Array<number | "ellipsis"> = [];
  for (let index = 0; index < sortedPages.length; index += 1) {
    const page = sortedPages[index];
    const previous = sortedPages[index - 1];
    if (previous && page - previous > 1) {
      items.push("ellipsis");
    }
    items.push(page);
  }

  return items;
}

export function pagerHtml(currentPage: number, hasMore: boolean, pageSize: number, offset: number, rowCount: number, total: number): string {
  const maxPage = total > 0 ? Math.max(1, Math.ceil(total / Math.max(1, pageSize))) : 1;
  const pageButtons = visiblePagerItems(currentPage, maxPage)
    .map((item) => {
      if (item === "ellipsis") {
        return '<span class="btn btn-sm btn-link text-muted disabled" aria-hidden="true">...</span>';
      }

      const active = item === currentPage;
      return `<button type="button" class="btn btn-sm ${active ? "btn-primary" : "btn-outline-secondary"}" data-page-jump="${item}"${active ? " disabled" : ""}>${item}</button>`;
    })
    .join("");

  const pageSizeOptions = ADMIN_LIST_PAGE_SIZE_OPTIONS
    .map((size) => `<option value="${size}"${size === pageSize ? " selected" : ""}>${size}</option>`)
    .join("");

  return (
    '<div class="d-flex flex-wrap gap-2 align-items-center justify-content-center">' +
      `<button type="button" class="btn btn-sm btn-outline-secondary" data-page-prev${currentPage <= 1 ? " disabled" : ""}>Prev</button>` +
      pageButtons +
      `<button type="button" class="btn btn-sm btn-outline-secondary" data-page-next${!hasMore ? " disabled" : ""}>Next</button>` +
      '<span class="small text-muted ms-1">Rows</span>' +
      `<select class="form-select form-select-sm" data-page-size style="width:auto">${pageSizeOptions}</select>` +
      `<span class="small text-muted ms-1">${pagerRangeText(offset, rowCount, total)}</span>` +
    "</div>"
  );
}
