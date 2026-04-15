import { useCallback, useImperativeHandle, useState } from "preact/hooks";
import { forwardRef, type Ref } from "preact/compat";
import { IconLink, IconPlus, IconRemove } from "./icons";

const DOMAIN_LABELS: Record<string, string> = {
  "linkedin.com": "LinkedIn",
  "www.linkedin.com": "LinkedIn",
  "xing.com": "Xing",
  "www.xing.com": "Xing",
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
  "datatracker.ietf.org": "IETF Datatracker",
  "ieee.org": "IEEE",
  "dl.acm.org": "ACM Digital Library",
  "github.com": "GitHub",
  "www.github.com": "GitHub",
  "gitlab.com": "GitLab",
  "www.gitlab.com": "GitLab",
  "twitter.com": "X (Twitter)",
  "www.twitter.com": "X (Twitter)",
  "x.com": "X (Twitter)",
  "bsky.app": "Bluesky",
  "youtube.com": "YouTube",
  "www.youtube.com": "YouTube",
  "en.wikipedia.org": "Wikipedia",
};

function detectLabel(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (DOMAIN_LABELS[hostname]) return DOMAIN_LABELS[hostname];
    const bare = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
    return DOMAIN_LABELS[bare] ?? bare;
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

export interface ProfileLinksHandle {
  getLinks(): string[];
  setLinks(urls: string[]): void;
}

interface ProfileLinksInputProps {
  fieldName: string;
  max?: number;
}

export const ProfileLinksInput = forwardRef(function ProfileLinksInput(
  { fieldName, max = 10 }: ProfileLinksInputProps,
  ref: Ref<ProfileLinksHandle>,
) {
  const [links, setLinksState] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");

  useImperativeHandle(
    ref,
    () => ({
      getLinks: () => [...links],
      setLinks: (urls: string[]) => setLinksState(urls.slice(0, max)),
    }),
    [links, max],
  );

  const atMax = links.length >= max;

  const tryAdd = useCallback(() => {
    const raw = inputValue.trim();
    setError("");
    if (!raw) return;

    if (!isValidUrl(raw)) {
      setError("Please enter a valid URL (must start with https:// or http://).");
      return;
    }
    if (links.includes(raw)) {
      setError("This URL has already been added.");
      return;
    }
    if (links.length >= max) {
      setError(`You can add at most ${max} profile links.`);
      return;
    }

    setLinksState([...links, raw]);
    setInputValue("");
  }, [inputValue, links, max]);

  const remove = useCallback(
    (index: number) => {
      setLinksState(links.filter((_, i) => i !== index));
    },
    [links],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        tryAdd();
      }
    },
    [tryAdd],
  );

  return (
    <>
      <p class="form-text mt-0 mb-2">
        Add professional profile links that demonstrate your expertise, such as LinkedIn, GitHub, ORCID, research
        publications, or any page that shows your work.
      </p>

      <div class="profile-links-pills" aria-label="Added profile links">
        {links.map((url, i) => {
          const label = detectLabel(url);
          return (
            <span key={url} class="profile-links-pill" title={url}>
              <span class="profile-links-pill-icon">
                <IconLink />
              </span>
              <span class="profile-links-pill-label">{label}</span>
              <button
                type="button"
                class="profile-links-pill-remove"
                aria-label={`Remove ${label}`}
                onClick={() => remove(i)}
              >
                <IconRemove />
              </button>
            </span>
          );
        })}
      </div>

      {!atMax && (
        <div class="profile-links-add-row">
          <input
            type="url"
            class="form-control form-control-sm profile-links-input"
            placeholder="https://"
            aria-label="Profile URL"
            value={inputValue}
            onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            class="btn btn-outline-secondary btn-sm profile-links-add-btn"
            aria-label="Add profile link"
            onClick={tryAdd}
          >
            <IconPlus />
          </button>
        </div>
      )}

      {error && (
        <div class="profile-links-error form-text text-danger" aria-live="polite">
          {error}
        </div>
      )}

      {/* Hidden inputs for form serialization */}
      <span hidden>
        {links.map((url, i) => (
          <input key={i} type="hidden" name={`${fieldName}.${i}`} value={url} />
        ))}
      </span>
    </>
  );
});
