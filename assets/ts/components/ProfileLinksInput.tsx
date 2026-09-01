import { useCallback, useId, useImperativeHandle, useState } from "preact/hooks";
import { forwardRef, type Ref } from "preact/compat";
import { IconPlus } from "./icons";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { StateIcon } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
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
  helpText?: string;
  inputAriaLabel?: string;
}

export const ProfileLinksInput = forwardRef(function ProfileLinksInput(
  {
    fieldName,
    max = MAX_LINKS,
    value,
    onChange,
    helpText = "Add professional profile links that demonstrate your expertise, such as LinkedIn, GitHub, ORCID, research publications, or any page that shows your work.",
    inputAriaLabel = "Profile URL",
  }: ProfileLinksInputProps,
  ref: Ref<ProfileLinksHandle>,
) {
  const [internalLinks, setInternalLinks] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [error, setError] = useState("");
  const errorId = `${useId()}-profile-links-error`;
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
    <div class="pk-stack pk-stack--snug">
      {/* Prose about the whole widget — the chips as well as the box that adds
          one — rather than one control's help text, so it is muted small print
          and not a `pk-field__help` sitting outside any field. */}
      <p class="pk-muted pk-small">{helpText}</p>

      {links.length > 0 && (
        // A bare `aria-label` on a `<div>` is discarded, so the set of added
        // links used to be an unnamed anonymous box. `role="group"` is what
        // gives the name somewhere to land.
        <div class="pk-cluster" role="group" aria-label="Added profile links">
          {links.map((url, i) => {
            const label = getLinkLabel(url);
            return (
              <Chip key={url} removeLabel={label} onRemove={() => remove(i)}>
                <span title={url}>{label}</span>
              </Chip>
            );
          })}
        </div>
      )}

      {/* At the cap with nothing to report there is no field left to draw, and
          an empty one would still take a slot in the parent's rhythm. */}
      {(!atMax || Boolean(error)) && (
        <div class={["pk-field", error ? "pk-field--invalid" : null].filter(Boolean).join(" ")}>
          {!atMax && (
            // `pk-field__control` is the design system's control box: one flex
            // row, and `pk-input`'s `min-width: 0` lets the URL field absorb the
            // shrinking so the square add button keeps its size. This is what
            // the Bootstrap `input-group` was doing.
            <div class="pk-field__control">
              <TextInput
                type="url"
                placeholder="https://"
                aria-label={inputAriaLabel}
                aria-invalid={error ? "true" : undefined}
                aria-describedby={error ? errorId : undefined}
                value={inputValue}
                onInput={(e) => setInputValue((e.target as HTMLInputElement).value)}
                onKeyDown={handleKeyDown}
              />
              <Button icon aria-label="Add profile link" onClick={tryAdd}>
                <IconPlus />
              </Button>
            </div>
          )}

          {error && (
            // A rejected URL blocks the add, so it interrupts rather than
            // waiting politely — and it carries the state mark as well as the
            // colour, because a colour on its own is not a status.
            <p class="pk-field__message" id={errorId} role="alert">
              <StateIcon state="invalid" class="pk-field__message-icon" />
              {error}
            </p>
          )}
        </div>
      )}

      {/* Hidden inputs for form serialization */}
      <span hidden>
        {links.map((url, i) => (
          <input key={i} type="hidden" name={`${fieldName}.${i}`} value={url} />
        ))}
      </span>
    </div>
  );
});
