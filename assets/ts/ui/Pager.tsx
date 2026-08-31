/**
 * Pager — offset pagination for a list.
 *
 * The page window is computed by a pure helper that can be unit tested
 * independently. When pageCount exceeds 7, the pager shows the first and
 * last pages, the current page, one neighbour either side, and an ellipsis
 * where pages are omitted.
 */

import { useId } from "preact/hooks";

import "./Pager.css";

/**
 * Compute the sequence of pages to display.
 *
 * @param page 1-based page number (current)
 * @param pageCount total number of pages
 * @returns array of page numbers and "gap" placeholders for ellipsis
 */
export function pageWindow(page: number, pageCount: number): ReadonlyArray<number | "gap"> {
  if (pageCount <= 1) return [];
  if (pageCount <= 7) {
    // Show all pages
    const pages: (number | "gap")[] = [];
    for (let i = 1; i <= pageCount; i++) {
      pages.push(i);
    }
    return pages;
  }

  // pageCount > 7: show first, last, current with one neighbour either side, gaps in between
  const pages: (number | "gap")[] = [];
  const visible = new Set<number>();

  // Always include first and last
  visible.add(1);
  visible.add(pageCount);

  // Current page and neighbours
  visible.add(page);
  if (page > 1) visible.add(page - 1);
  if (page < pageCount) visible.add(page + 1);

  // Sort and build output with gaps
  const sorted = Array.from(visible).sort((a, b) => a - b);

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];

    pages.push(current);

    // Add gap if there's a discontinuity
    if (next && next - current > 1) {
      pages.push("gap");
    }
  }

  return pages;
}

/**
 * How many rows a page holds.
 *
 * This belongs with the pager rather than beside it: it is the other half of
 * the same decision, and a reader looking for "show me more at once" looks
 * where the page numbers are.
 */
export interface PagerPageSize {
  value: number;
  options: readonly number[];
  onChange: (size: number) => void;
}

export interface PagerProps {
  page: number;
  pageCount: number;
  total: number;
  rangeStart: number;
  rangeEnd: number;
  onSelect: (page: number) => void;
  label?: string;
  pageSize?: PagerPageSize;
}

export function Pager({
  page,
  pageCount,
  total,
  rangeStart,
  rangeEnd,
  onSelect,
  label = "Pagination",
  pageSize,
}: PagerProps) {
  const sizeId = useId();
  const pages = pageWindow(page, pageCount);
  const isPrevDisabled = page <= 1;
  const isNextDisabled = page >= pageCount;

  const handlePrevClick = () => {
    if (!isPrevDisabled) {
      onSelect(page - 1);
    }
  };

  const handleNextClick = () => {
    if (!isNextDisabled) {
      onSelect(page + 1);
    }
  };

  const handlePageClick = (p: number) => {
    onSelect(p);
  };

  return (
    <nav class="pk-pager" aria-label={label}>
      <div class="pk-pager__summary">
        {rangeStart}–{rangeEnd} of {total}
      </div>

      <ol class="pk-pager__list">
        <li class="pk-pager__item">
          <button
            class="pk-pager__button pk-pager__button--prev"
            disabled={isPrevDisabled}
            onClick={handlePrevClick}
            aria-label="Previous page"
          >
            Previous
          </button>
        </li>

        {pages.map((item) => {
          if (item === "gap") {
            return (
              <li key="gap" class="pk-pager__item pk-pager__item--gap" aria-hidden="true">
                …
              </li>
            );
          }

          const isCurrentPage = item === page;

          return (
            <li key={item} class="pk-pager__item">
              <button
                class="pk-pager__button"
                aria-current={isCurrentPage ? "page" : undefined}
                onClick={() => handlePageClick(item)}
              >
                {item}
              </button>
            </li>
          );
        })}

        <li class="pk-pager__item">
          <button
            class="pk-pager__button pk-pager__button--next"
            disabled={isNextDisabled}
            onClick={handleNextClick}
            aria-label="Next page"
          >
            Next
          </button>
        </li>
      </ol>

      {pageSize && (
        <div class="pk-pager__size">
          <label for={sizeId} class="pk-pager__size-label">
            Rows per page
          </label>
          <select
            id={sizeId}
            class="pk-pager__size-select"
            value={pageSize.value}
            onChange={(event) => pageSize.onChange(Number((event.target as HTMLSelectElement).value))}
          >
            {pageSize.options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      )}
    </nav>
  );
}
