import type { TrustListPublisher } from "../../shared/schemas/trust-lists";

/**
 * The List of Trust Lists, rendered from the snapshot the build fetched.
 *
 * The published site read the release at build time and wrote the whole
 * directory into the page; only the "improve this entry" pencil and the
 * heading anchor are chrome. Rendering it here keeps the page static — the
 * browser was the wrong place to call GitHub from, which CORS and the site's
 * own CSP both made plain.
 */
function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      fill="currentColor"
      class="bi bi-pencil-square"
      viewBox="0 0 16 16"
    >
      <path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z" />
      <path
        fill-rule="evenodd"
        d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"
      />
    </svg>
  );
}

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
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            fill="currentColor"
            class="bi bi-link-45deg"
            viewBox="0 0 16 16"
          >
            <path d="M4.715 6.542L3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.001 1.001 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z" />
            <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 0 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 0 0-4.243-4.243L6.586 4.672z" />
          </svg>
        </a>{" "}
        <a
          href={`https://github.com/pkic/ltl/edit/main/data/${publisher.id ?? ""}.yaml`}
          title={`Improve information for ${name}`}
          target="_blank"
          rel="noopener"
        >
          <PencilIcon />
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
