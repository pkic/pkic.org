import type { TrustListPublisher } from "../../shared/schemas/trust-lists";
import { IconLink, IconPencil } from "../ui/MediaIcons";

/**
 * The List of Trust Lists, rendered from the snapshot the build fetched.
 *
 * The published site read the release at build time and wrote the whole
 * directory into the page; only the "improve this entry" pencil and the
 * heading anchor are chrome. Rendering it here keeps the page static — the
 * browser was the wrong place to call GitHub from, which CORS and the site's
 * own CSP both made plain.
 */
function TrustListEntry({ entry }: { entry: NonNullable<NonNullable<TrustListPublisher["trust-lists"]>["trust"]>[0] }) {
  return (
    <li>
      <strong>{(entry.purposes ?? []).join(", ")}</strong>
      {entry.list?.length ? (
        <ul>
          <li>
            View or download list:{" "}
            {entry.list.map((target) => (
              <a
                class="pk-badge pk-badge--neutral"
                href={target.url}
                key={`${target.type}-${target.url}`}
                rel="noopener"
                target="_blank"
              >
                {target.type}
              </a>
            ))}
          </li>
        </ul>
      ) : null}
      {entry.audit?.length ? (
        <ul>
          <li>
            Audit scheme:{" "}
            {entry.audit.map((audit) => (
              <span class="pk-badge pk-badge--accent" key={audit.name}>
                {audit.name}
              </span>
            ))}
          </li>
        </ul>
      ) : null}
    </li>
  );
}

function TrustListPublisherSection({ publisher }: { publisher: TrustListPublisher }) {
  const name = publisher.name ?? "Trust-list publisher";
  const lists = publisher["trust-lists"];
  return (
    <>
      <h2 id={name} aria-label={name}>
        {name}{" "}
        <a class="header-link" href={`#${encodeURIComponent(name)}`} aria-label="Link to this section">
          <IconLink />
        </a>{" "}
        <a
          href={`https://github.com/pkic/ltl/edit/main/data/${publisher.id ?? ""}.yaml`}
          title={`Improve information for ${name}`}
          target="_blank"
          rel="noopener"
        >
          <IconPencil />
        </a>
      </h2>
      {publisher.website ? (
        <p>
          <small>
            <a href={publisher.website}>{publisher.website}</a>
          </small>
        </p>
      ) : null}
      {publisher.description ? <p>{publisher.description}</p> : null}
      {lists ? (
        <div>
          {lists.info ? (
            <p>
              <strong>List info:</strong> {lists.info}
            </p>
          ) : null}
          {lists.policy ? (
            <p>
              <strong>List policy:</strong> {lists.policy}
            </p>
          ) : null}
          {lists.trust?.length ? (
            <ul>
              {lists.trust.map((entry, index) => (
                <TrustListEntry entry={entry} key={`${entry.purposes?.join()}-${index}`} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <hr />
    </>
  );
}

export function TrustLists({ publishers }: { publishers: TrustListPublisher[] }) {
  if (!publishers.length) {
    return (
      <p>
        The current list is not available.{" "}
        <a href="https://github.com/pkic/ltl/releases" target="_blank" rel="noopener noreferrer">
          Open the published releases
        </a>
        .
      </p>
    );
  }
  return (
    <>
      {publishers.map((publisher) => (
        <TrustListPublisherSection key={publisher.id ?? publisher.name} publisher={publisher} />
      ))}
    </>
  );
}
