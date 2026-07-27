/**
 * Member directory listing (PRD §1.6 Part B). Replaces the Hugo-data-driven
 * A-Z grid (layouts/partials/members/listing.html, driven by hugo.Data.members
 * at build time) with a Preact component that fetches GET /api/v1/members.
 *
 * D1 is now the source of truth (§6 Step 2 has run), so this fetches once
 * per page-load (group is fixed per page: "organization" for /members/,
 * "independent" for /members/independent/) at a limit generous enough to
 * cover the whole directory in one request, then filters/groups by letter
 * client-side — mirroring the instant-filter UX the old assets/js/members.js
 * script gave, without a network round-trip per keystroke. The public
 * endpoint's cache headers (5min client / 15min CDN) make this cheap even
 * under repeated page loads.
 */
import { render } from "preact";
import { useMemo, useState, useEffect, useCallback } from "preact/hooks";
import { getJson } from "../shared/api-client";
import { Spinner } from "../components/Spinner";
import { ErrorAlert } from "../components/ErrorAlert";

const API_BASE_FALLBACK = "/api/v1";
const FETCH_LIMIT = 500;
const DIGITS = new Set("0123456789".split(""));

export interface DirectoryMember {
  id: string;
  name: string;
  memberType: string;
  tier: string | null;
  website: string | null;
  description: string | null;
  slogan: string | null;
  logoUrl: string | null;
  memberSince: string;
}

interface DirectoryResponse {
  members: DirectoryMember[];
  total: number;
}

function letterBucket(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  if (DIGITS.has(c)) return "#";
  if (/^[A-Z]$/.test(c)) return c;
  return "…";
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

function MemberCard({ member, detailBase }: { member: DirectoryMember; detailBase: string }) {
  const href = `${detailBase}?id=${encodeURIComponent(member.id)}`;
  const colorIdx = member.name.length % 6;

  return (
    <div class="member-card bento-card">
      <a class="stretched-link" href={href} aria-label={member.name}></a>
      <div class="member-card-logo-wrap">
        {member.logoUrl ? (
          <img class="member-card-logo" src={member.logoUrl} alt={`${member.name} logo`} loading="lazy" />
        ) : (
          <div class={`member-card-initials initial-color-${colorIdx}`}>{initialsFor(member.name)}</div>
        )}
      </div>
      <div class="member-card-name">{member.name}</div>
      {member.slogan && <div class="member-card-slogan">{member.slogan}</div>}
      {member.description && (
        <p class="member-card-description">
          {member.description.length > 160 ? `${member.description.slice(0, 160).trimEnd()}…` : member.description}
        </p>
      )}
    </div>
  );
}

function DirectoryGrid({
  members,
  prefix,
  detailBase,
}: {
  members: DirectoryMember[];
  prefix: string;
  detailBase: string;
}) {
  const buckets = useMemo(() => {
    const map = new Map<string, DirectoryMember[]>();
    for (const m of members) {
      const key = letterBucket(m.name);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(m);
    }
    return map;
  }, [members]);

  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const hasNum = buckets.has("#");
  const hasOther = buckets.has("…");
  const presentLetters = letters.filter((l) => buckets.has(l));

  if (members.length === 0) {
    return <p class="text-muted fst-italic text-center mt-3">No members found matching your search.</p>;
  }

  return (
    <div class="members-layout">
      <nav class="members-az-sidebar d-none d-lg-flex flex-column" aria-label="Jump to letter">
        {hasNum && (
          <a class="az-sidebar-link" href={`#${prefix}-NUM`}>
            #
          </a>
        )}
        {letters.map((l) => (
          <a key={l} class={`az-sidebar-link${buckets.has(l) ? "" : " is-empty"}`} href={`#${prefix}-${l}`}>
            {l}
          </a>
        ))}
        {hasOther && (
          <a class="az-sidebar-link" href={`#${prefix}-OTHER`}>
            …
          </a>
        )}
      </nav>
      <div class="members-content">
        {hasNum && (
          <section class="member-letter-group" id={`${prefix}-NUM`}>
            <h3 class="member-letter-heading">0 – 9</h3>
            <div class="members-grid">
              {buckets.get("#")!.map((m) => (
                <MemberCard key={m.id} member={m} detailBase={detailBase} />
              ))}
            </div>
          </section>
        )}
        {presentLetters.map((l) => (
          <section class="member-letter-group" id={`${prefix}-${l}`} key={l}>
            <h3 class="member-letter-heading">{l}</h3>
            <div class="members-grid">
              {buckets.get(l)!.map((m) => (
                <MemberCard key={m.id} member={m} detailBase={detailBase} />
              ))}
            </div>
          </section>
        ))}
        {hasOther && (
          <section class="member-letter-group" id={`${prefix}-OTHER`}>
            <h3 class="member-letter-heading">Other</h3>
            <div class="members-grid">
              {buckets.get("…")!.map((m) => (
                <MemberCard key={m.id} member={m} detailBase={detailBase} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function MemberDirectory({
  apiBase,
  group,
  prefix,
  label,
  detailBase,
}: {
  apiBase: string;
  group: "organization" | "independent";
  prefix: string;
  label: string;
  detailBase: string;
}) {
  const [members, setMembers] = useState<DirectoryMember[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await getJson<DirectoryResponse>(`${apiBase}/members?group=${group}&limit=${FETCH_LIMIT}&offset=0`);
      setMembers(data.members);
      setTotal(data.total);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [apiBase, group]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!members) return [];
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q));
  }, [members, search]);

  if (error) return <ErrorAlert error={error} />;
  if (!members) return <Spinner />;

  return (
    <>
      <div class="py-3">
        <div class="container">
          <div class="members-search-bar mx-auto">
            <div class="input-group input-group-lg">
              <span class="input-group-text bg-white border-end-0 text-muted">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
                  <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.868-3.834zm-5.242 1.406a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" />
                </svg>
              </span>
              <input
                type="search"
                class="form-control border-start-0 ps-0"
                placeholder={`Filter ${members.length} ${label}…`}
                aria-label={`Filter ${label}`}
                autocomplete="off"
                value={search}
                onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
              />
            </div>
          </div>
          {total > members.length && (
            <p class="text-muted small text-center mt-2">
              Showing the first {members.length.toLocaleString()} of {total.toLocaleString()} {label}.
            </p>
          )}
        </div>
      </div>
      <div class="container-fluid px-2 px-md-4 pb-5">
        <DirectoryGrid members={filtered} prefix={prefix} detailBase={detailBase} />
      </div>
    </>
  );
}

function main(): void {
  const root = document.querySelector<HTMLElement>("[data-member-directory]");
  if (!root) return;

  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const group = root.dataset.group === "independent" ? "independent" : "organization";
  const prefix = root.dataset.prefix ?? "m";
  const label = root.dataset.label ?? "members";
  const detailBase = root.dataset.detailBase ?? "/members/profile/";

  render(
    <MemberDirectory apiBase={apiBase} group={group} prefix={prefix} label={label} detailBase={detailBase} />,
    root,
  );
}

main();
