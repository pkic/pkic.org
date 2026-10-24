import { useCallback, useId, useImperativeHandle, useState } from "preact/hooks";
import { forwardRef, type Ref } from "preact/compat";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Field, StateIcon, type FieldControlProps } from "../ui/Field";
import type { FieldPresentation } from "../hooks/useContractForm";
import { InputGroup } from "../ui/InputGroup";
import { LinkMark } from "../ui/LinkMark";
import "./ProfileLinksInput.css";
import { TextInput } from "../ui/TextControl";
import { getLinkLabel, hasDuplicateLink, MAX_LINKS, parseLinkUrl } from "../../shared/schemas/links";

export interface ProfileLinksHandle {
  getLinks(): string[];
  setLinks(urls: string[]): void;
}

interface ProfileLinksInputProps {
  fieldName: string;
  /**
   * The widget's own name, shown the way a field label is shown.
   *
   * Without one it rendered as a paragraph of help above an unlabeled box,
   * so among labeled neighbours it read as prose that had lost its field
   * (#53). It is a group rather than a single control, so the name is a
   * `<legend>`-shaped heading pointing at the group, not a `<label>` pointing
   * at whichever input happens to be last.
   */
  label?: string;
  max?: number;
  value?: string[];
  onChange?: (links: string[]) => void;
  /** Include the unfinished entry in the owning form's contract validation and save. */
  onPendingChange?: (link: string) => void;
  presentation?: FieldPresentation;
  helpText?: string;
  inputAriaLabel?: string;
}

export const ProfileLinksInput = forwardRef(function ProfileLinksInput(
  {
    fieldName,
    label,
    max = MAX_LINKS,
    value,
    onChange,
    onPendingChange,
    presentation,
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
      getLinks: () => (inputValue.trim() ? [...links, inputValue.trim()] : [...links]),
      setLinks,
    }),
    [links, inputValue, setLinks],
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
    onPendingChange?.("");
  }, [inputValue, links, linkLimit, setLinks, onPendingChange]);

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

  const body = (control?: FieldControlProps) => (
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
                <span class="pk-profile-links__chip" title={url}>
                  <LinkMark url={url} class="pk-profile-links__mark" />
                  {label}
                </span>
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
            // The shared input group: the URL field absorbs the shrinking so
            // the add button keeps its label width and the input's height.
            <InputGroup>
              <TextInput
                {...control}
                name={fieldName}
                type="url"
                placeholder="https://"
                aria-label={inputAriaLabel}
                aria-invalid={error ? "true" : control?.["aria-invalid"]}
                aria-describedby={error ? errorId : control?.["aria-describedby"]}
                value={inputValue}
                onInput={(e) => {
                  const next = e.currentTarget.value;
                  setInputValue(next);
                  setError("");
                  onPendingChange?.(next);
                }}
                onKeyDown={handleKeyDown}
              />
              <Button aria-label="Add profile link" onClick={tryAdd}>
                Add link
              </Button>
            </InputGroup>
          )}

          {error && (
            // A rejected URL blocks the add, so it interrupts rather than
            // waiting politely — and it carries the state mark as well as the
            // color, because a color on its own is not a status.
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

  /*
   * Named through the design system's own field when the caller gives it a
   * name, in the `group` shape — this is several inputs answering one
   * question, so a `<label for>` would name whichever one it pointed at and
   * leave the rest anonymous.
   */
  return label ? (
    <Field label={label} group {...presentation}>
      {body}
    </Field>
  ) : (
    body()
  );
});
