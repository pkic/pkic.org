import "../../design/tokens.content.generated.css";
import "./ContentRequirements.css";

export interface ContentRequirementItem {
  /** Stable identifier: the permalink target and the selection-feedback item. */
  id: string;
  /** Short position shown in the marker, such as "1"; the full identifier stays in the link. */
  label: string;
  textHtml: string;
  noteHtml?: string;
}

/**
 * Normative requirements that must all hold, presented as one statement set in the page accent.
 * `marker` and `label` name what the requirements define, such as a maturity level; `includes`
 * links to earlier sets that also apply.
 */
export function ContentRequirements({
  marker,
  label,
  introductionHtml,
  includes,
  itemName,
  items,
}: {
  marker?: string;
  label?: string;
  introductionHtml: string;
  includes?: { labelHtml: string; links: Array<{ href: string; label: string }> };
  itemName: string;
  items: ContentRequirementItem[];
}) {
  const introductionId = `requirements-${items[0]?.id ?? "set"}`;
  return (
    <section class="pk-content-requirements" aria-labelledby={introductionId}>
      <div class="pk-content-requirements__head">
        {marker ? (
          <span class="pk-content-requirements__marker" aria-hidden="true">
            {marker}
          </span>
        ) : null}
        <div class="pk-content-requirements__heading">
          {label ? <p class="pk-content-requirements__label">{label}</p> : null}
          <p
            class="pk-content-requirements__introduction"
            id={introductionId}
            dangerouslySetInnerHTML={{ __html: introductionHtml }}
          />
        </div>
        {includes?.links.length ? (
          <p class="pk-content-requirements__includes">
            <span dangerouslySetInnerHTML={{ __html: includes.labelHtml }} />
            {includes.links.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </p>
        ) : null}
      </div>
      <ol class="pk-content-requirements__items">
        {items.map((item) => (
          <li key={item.id} id={item.id} data-content-item-id={item.id}>
            <a
              class="pk-content-requirements__position"
              href={`#${item.id}`}
              aria-label={`${itemName} ${item.id}`}
              title={`${itemName} ${item.id}`}
            >
              {item.label}
            </a>
            <div>
              <p class="pk-content-requirements__text" dangerouslySetInnerHTML={{ __html: item.textHtml }} />
              {item.noteHtml ? (
                <p class="pk-content-requirements__note" dangerouslySetInnerHTML={{ __html: item.noteHtml }} />
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
