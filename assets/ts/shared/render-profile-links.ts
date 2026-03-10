/**
 * Profile-link widget — domain-detecting URL list.
 *
 * Users add URLs one at a time via a text input + "+" button.
 * Each added URL is displayed as a labelled pill; the site name is detected
 * automatically from the domain so users see "LinkedIn", "ResearchGate", etc.
 * A × button removes the entry.
 *
 * Hidden <input type="hidden"> elements store values so native form
 * serialisation works — but the submit handler should prefer calling
 * `widget.getLinks()` directly for a clean string array.
 */

/** Map of hostname → human-readable label. */
const DOMAIN_LABELS: Record<string, string> = {
  // Professional networks
  "linkedin.com": "LinkedIn",
  "www.linkedin.com": "LinkedIn",
  "xing.com": "Xing",
  "www.xing.com": "Xing",
  // Research profiles
  "orcid.org": "ORCID",
  "www.orcid.org": "ORCID",
  "researchgate.net": "ResearchGate",
  "www.researchgate.net": "ResearchGate",
  "scholar.google.com": "Google Scholar",
  "academia.edu": "Academia.edu",
  "www.academia.edu": "Academia.edu",
  "semanticscholar.org": "Semantic Scholar",
  "www.semanticscholar.org": "Semantic Scholar",
  "ssrn.com": "SSRN",
  "papers.ssrn.com": "SSRN",
  "arxiv.org": "arXiv",
  "zenodo.org": "Zenodo",
  "figshare.com": "Figshare",
  // Standards & tech
  "datatracker.ietf.org": "IETF Datatracker",
  "ieee.org": "IEEE",
  "dl.acm.org": "ACM Digital Library",
  "github.com": "GitHub",
  "www.github.com": "GitHub",
  "gitlab.com": "GitLab",
  "www.gitlab.com": "GitLab",
  // Social
  "twitter.com": "X (Twitter)",
  "www.twitter.com": "X (Twitter)",
  "x.com": "X (Twitter)",
  "bsky.app": "Bluesky",
  // Other
  "youtube.com": "YouTube",
  "www.youtube.com": "YouTube",
  "en.wikipedia.org": "Wikipedia",
};

/** Detect a human-readable label from a URL, falling back to the bare hostname. */
function detectLabel(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (DOMAIN_LABELS[hostname]) return DOMAIN_LABELS[hostname];
    // Strip leading www. and try again
    const bare = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
    if (DOMAIN_LABELS[bare]) return DOMAIN_LABELS[bare];
    return bare;
  } catch {
    return url.substring(0, 40);
  }
}

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export interface ProfileLinksWidget {
  /** Returns the current list of URLs. */
  getLinks(): string[];
  /** Replaces the list (e.g. when pre-filling edit forms). */
  setLinks(urls: string[]): void;
  /** The container element. */
  el: HTMLElement;
}

const SVG_LINK =
  `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">` +
  `<path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/>` +
  `<path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/>` +
  `</svg>`;

const SVG_REMOVE =
  `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">` +
  `<path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/>` +
  `</svg>`;

const SVG_PLUS =
  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">` +
  `<path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"/>` +
  `</svg>`;

/**
 * Renders a profile-link widget into `container`.
 *
 * @param container  The element to render into.
 * @param fieldName  Base name for the hidden inputs (values are `fieldName.0`, `fieldName.1`, …).
 * @param options    `max` — maximum number of links (default 10).
 */
export function renderProfileLinks(
  container: HTMLElement,
  fieldName: string,
  options: { max?: number } = {},
): ProfileLinksWidget {
  const max = options.max ?? 10;
  const links: string[] = [];

  // Instruction text
  const hint = document.createElement("p");
  hint.className = "form-text mt-0 mb-2";
  hint.textContent =
    "Add professional profile links that demonstrate your expertise, such as LinkedIn, GitHub, ORCID, research publications," +
    "or any page that shows your work.";

  // Pill container
  const pillList = document.createElement("div");
  pillList.className = "profile-links-pills";
  pillList.setAttribute("aria-label", "Added profile links");

  // Input row (input + + button)
  const addRow = document.createElement("div");
  addRow.className = "profile-links-add-row";

  const urlInput = document.createElement("input");
  urlInput.type = "url";
  urlInput.className = "form-control form-control-sm profile-links-input";
  urlInput.placeholder = "https://";
  urlInput.setAttribute("aria-label", "Profile URL");

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-outline-secondary btn-sm profile-links-add-btn";
  addBtn.setAttribute("aria-label", "Add profile link");
  addBtn.innerHTML = SVG_PLUS;

  const errorEl = document.createElement("div");
  errorEl.className = "profile-links-error form-text text-danger";
  errorEl.setAttribute("aria-live", "polite");

  addRow.append(urlInput, addBtn);

  // Hidden inputs live outside the pill list so flex layout is unaffected
  const hiddenContainer = document.createElement("span");
  hiddenContainer.hidden = true;

  container.append(hint, pillList, addRow, errorEl, hiddenContainer);

  function syncHidden(): void {
    hiddenContainer.innerHTML = "";
    links.forEach((url, i) => {
      const hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = `${fieldName}.${i}`;
      hidden.value = url;
      hiddenContainer.append(hidden);
    });
  }

  function renderPills(): void {
    pillList.innerHTML = "";
    links.forEach((url, i) => {
      const label = detectLabel(url);

      const pill = document.createElement("span");
      pill.className = "profile-links-pill";
      pill.title = url;

      const icon = document.createElement("span");
      icon.className = "profile-links-pill-icon";
      icon.innerHTML = SVG_LINK;

      const labelSpan = document.createElement("span");
      labelSpan.className = "profile-links-pill-label";
      labelSpan.textContent = label;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "profile-links-pill-remove";
      removeBtn.setAttribute("aria-label", `Remove ${label}`);
      removeBtn.innerHTML = SVG_REMOVE;
      removeBtn.addEventListener("click", () => {
        links.splice(i, 1);
        renderPills();
        syncHidden();
        updateAddState();
      });

      pill.append(icon, labelSpan, removeBtn);
      pillList.append(pill);
    });
  }

  function updateAddState(): void {
    const atMax = links.length >= max;
    addRow.hidden = atMax;
    addBtn.disabled = atMax;
  }

  function tryAdd(): void {
    const raw = urlInput.value.trim();
    errorEl.textContent = "";

    if (!raw) return;

    if (!isValidUrl(raw)) {
      errorEl.textContent = "Please enter a valid URL (must start with https:// or http://).";
      urlInput.focus();
      return;
    }

    if (links.includes(raw)) {
      errorEl.textContent = "This URL has already been added.";
      urlInput.focus();
      return;
    }

    if (links.length >= max) {
      errorEl.textContent = `You can add at most ${max} profile links.`;
      return;
    }

    links.push(raw);
    urlInput.value = "";
    errorEl.textContent = "";
    renderPills();
    syncHidden();
    updateAddState();
    urlInput.focus();
  }

  addBtn.addEventListener("click", tryAdd);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryAdd();
    }
  });

  updateAddState();
  renderPills();

  return {
    el: container,
    getLinks: () => [...links],
    setLinks: (urls: string[]) => {
      links.length = 0;
      for (const url of urls.slice(0, max)) {
        links.push(url);
      }
      renderPills();
      syncHidden();
      updateAddState();
    },
  };
}
