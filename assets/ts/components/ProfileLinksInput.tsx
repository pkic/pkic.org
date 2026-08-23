import { useCallback, useImperativeHandle, useState } from "preact/hooks";
import { forwardRef, type Ref } from "preact/compat";
import { IconLink, IconPlus, IconRemove } from "./icons";
import { getLinkLabel, hasDuplicateLink, MAX_LINKS, parseLinkUrl } from "../../shared/schemas/links";

export interface ProfileLinksHandle {
  getLinks(): string[];
  setLinks(urls: string[]): void;
}

interface ProfileLinksInputProps {
  fieldName: string;
  max?: number;
  value?: string[];
  onChange?: (links: string[]) => void;
}

export const ProfileLinksInput = forwardRef(function ProfileLinksInput(
  { fieldName, max = MAX_LINKS, value, onChange }: ProfileLinksInputProps,
  ref: Ref<ProfileLinksHandle>,
) {
  const [internalLinks, setInternalLinks] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");
  const links = value ?? internalLinks;
  const linkLimit = Math.min(max, MAX_LINKS);

  const setLinks = useCallback(
    (next: string[]) => {
      const bounded = next.slice(0, linkLimit);
      if (value === undefined) setInternalLinks(bounded);
      onChange?.(bounded);
    },
    [linkLimit, onChange, value],
  );

  useImperativeHandle(
    ref,
    () => ({
      getLinks: () => [...links],
      setLinks,
    }),
    [links, setLinks],
  );

  const atMax = links.length >= linkLimit;

  const tryAdd = useCallback(() => {
    const raw = inputValue.trim();
    setError("");
    if (!raw) return;

    const url = parseLinkUrl(raw);
    if (!url) {
      setError("Please enter a valid URL (must start with https:// or http://).");
      return;
    }
    if (hasDuplicateLink(links, url)) {
      setError("This URL has already been added.");
      return;
    }
    if (links.length >= linkLimit) {
      setError(`You can add at most ${linkLimit} profile links.`);
      return;
    }

    setLinks([...links, url]);
    setInputValue("");
  }, [inputValue, links, linkLimit, setLinks]);

  const remove = useCallback(
    (index: number) => {
      setLinks(links.filter((_, i) => i !== index));
    },
    [links, setLinks],
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
          const label = getLinkLabel(url);
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
