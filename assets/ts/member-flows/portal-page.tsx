/**
 * Member portal — login + minimal profile view, mounted at /portal/.
 *
 * Mirrors the admin SPA's shape (assets/ts/admin/index.tsx + App.tsx +
 * shell/Login.tsx) but drastically simplified: no signals module, no
 * passkey login (members don't have passkey auth — see
 * functions/_lib/auth/member.ts's header comment), plain useState/useEffect
 * given the tiny scope (login + read-only profile + one form).
 *
 * Session probing reuses GET /api/v1/me itself rather than a dedicated
 * "am I logged in" endpoint — there is no member-session equivalent of
 * /api/v1/admin/auth/session, and /me is an idempotent read where a 401
 * means anonymous and a 200 means authenticated, so a separate probe
 * endpoint isn't needed.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getJson, postJson, ApiClientError } from "../shared/api-client";

interface OrganizationRepresentative {
  userId: string;
  name: string | null;
  email: string;
  isPrimaryContact: boolean;
  isSecondaryContact: boolean;
}

interface MyProfile {
  userId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  membershipCategory: string;
  organizationId: string | null;
  organizationName: string | null;
  isOrgContact: boolean;
  organizationRepresentatives: OrganizationRepresentative[] | null;
}

type AuthStatus = "loading" | "authenticated" | "anonymous";

function displayName(profile: MyProfile): string {
  if (profile.preferredName) return profile.preferredName;
  const full = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  return full || profile.email;
}

async function requestMagicLink(email: string): Promise<void> {
  await postJson("/api/v1/auth/member/request-link", { email });
  // Always show success to prevent email enumeration (mirrors admin Login).
}

async function verifyMagicLink(token: string): Promise<void> {
  await postJson("/api/v1/auth/member/verify-link", { token });
}

function LoginForm() {
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    if (!email) return;
    setError(null);
    setSubmitting(true);
    try {
      await requestMagicLink(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div id="portal-login-wrap" class="d-flex justify-content-center py-5">
      <div class="card shadow-sm" style="max-width: 420px; width: 100%;">
        <div class="card-body p-4">
          <h2 class="h4 mb-3">Member Portal</h2>
          <p class="text-muted">Enter your email to receive a sign-in link.</p>
          {sent ? (
            <div class="alert alert-success mt-3">
              ✓ If this address belongs to an active member, you'll receive a sign-in link shortly.
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                void handleSubmit(e);
              }}
            >
              <div class="mb-3">
                <label class="form-label fw-semibold" for="portal-inp-email">
                  Email
                </label>
                <input
                  class="form-control"
                  type="email"
                  id="portal-inp-email"
                  name="email"
                  placeholder="you@example.com"
                  required
                  autocomplete="email"
                />
              </div>
              <button type="submit" class="btn btn-success w-100" disabled={submitting}>
                {submitting ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
          )}
          {error && <div class="alert alert-danger mt-3">✕ Sign-in failed: {error}</div>}
        </div>
      </div>
    </div>
  );
}

function VerifyingOverlay() {
  return (
    <div class="d-flex flex-column align-items-center py-5">
      <div class="spinner-border text-success mb-3" role="status"></div>
      <p class="text-muted mb-0">Verifying your sign-in link…</p>
    </div>
  );
}

function AddCoworkerForm({ onAdded }: { onAdded: (rep: OrganizationRepresentative) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value.trim();
    const email = (form.elements.namedItem("email") as HTMLInputElement).value.trim();
    if (!name || !email) return;
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const created = await postJson<{ memberId: string; userId: string; name: string; email: string }>(
        "/api/v1/me/organization/members",
        { name, email },
      );
      setSuccess(`${created.name} (${created.email}) was added to your organization.`);
      onAdded({
        userId: created.userId,
        name: created.name,
        email: created.email,
        isPrimaryContact: false,
        isSecondaryContact: false,
      });
      form.reset();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not add this coworker. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="card mt-4">
      <div class="card-body">
        <h3 class="h5 mb-3">Add a coworker</h3>
        <p class="text-muted small">
          As a primary or secondary contact for your organization, you can enroll a coworker as a representative.
        </p>
        <form
          onSubmit={(e) => {
            void handleSubmit(e);
          }}
        >
          <div class="mb-3">
            <label class="form-label fw-semibold" for="portal-coworker-name">
              Name
            </label>
            <input class="form-control" type="text" id="portal-coworker-name" name="name" required />
          </div>
          <div class="mb-3">
            <label class="form-label fw-semibold" for="portal-coworker-email">
              Email
            </label>
            <input class="form-control" type="email" id="portal-coworker-email" name="email" required />
          </div>
          <button type="submit" class="btn btn-success" disabled={submitting}>
            {submitting ? "Adding…" : "Add coworker"}
          </button>
        </form>
        {success && <div class="alert alert-success mt-3">✓ {success}</div>}
        {error && <div class="alert alert-danger mt-3">✕ {error}</div>}
      </div>
    </div>
  );
}

function ProfileView({ profile: initialProfile }: { profile: MyProfile }) {
  const [profile, setProfile] = useState(initialProfile);

  return (
    <div class="py-4" style="max-width: 640px; margin: 0 auto;">
      <h2 class="h4 mb-3">Welcome, {displayName(profile)}</h2>
      <div class="card">
        <div class="card-body">
          <dl class="row mb-0">
            <dt class="col-sm-4">Email</dt>
            <dd class="col-sm-8">{profile.email}</dd>
            <dt class="col-sm-4">Membership category</dt>
            <dd class="col-sm-8">{profile.membershipCategory}</dd>
            {profile.organizationName && (
              <>
                <dt class="col-sm-4">Organization</dt>
                <dd class="col-sm-8">{profile.organizationName}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {profile.organizationRepresentatives && profile.organizationRepresentatives.length > 0 && (
        <div class="card mt-4">
          <div class="card-body">
            <h3 class="h5 mb-3">Organization representatives</h3>
            <ul class="list-group list-group-flush">
              {profile.organizationRepresentatives.map((rep) => (
                <li key={rep.userId} class="list-group-item d-flex justify-content-between align-items-center">
                  <span>
                    {rep.name ?? rep.email} <span class="text-muted small">({rep.email})</span>
                  </span>
                  {rep.isPrimaryContact && <span class="badge text-bg-success">Primary contact</span>}
                  {rep.isSecondaryContact && <span class="badge text-bg-secondary">Secondary contact</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {profile.isOrgContact && (
        <AddCoworkerForm
          onAdded={(rep) =>
            setProfile((p) => ({
              ...p,
              organizationRepresentatives: [...(p.organizationRepresentatives ?? []), rep],
            }))
          }
        />
      )}
    </div>
  );
}

function PortalApp() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [verifying, setVerifying] = useState(() => Boolean(new URLSearchParams(window.location.search).get("token")));
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(): Promise<void> {
      try {
        const data = await getJson<MyProfile>("/api/v1/me");
        if (!cancelled) {
          setProfile(data);
          setAuthStatus("authenticated");
        }
      } catch {
        if (!cancelled) setAuthStatus("anonymous");
      }
    }

    async function run(): Promise<void> {
      const token = new URLSearchParams(window.location.search).get("token");
      if (token) {
        try {
          await verifyMagicLink(token);
          history.replaceState({}, "", "/portal/");
        } catch (err) {
          if (!cancelled) {
            setVerifyError(
              err instanceof ApiClientError ? err.message : "The link may have expired or already been used.",
            );
            setVerifying(false);
            setAuthStatus("anonymous");
            return;
          }
        }
        if (!cancelled) setVerifying(false);
      }
      await loadProfile();
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (verifying) {
    return <VerifyingOverlay />;
  }

  if (authStatus === "loading") {
    return <VerifyingOverlay />;
  }

  if (authStatus === "authenticated" && profile) {
    return <ProfileView profile={profile} />;
  }

  return (
    <>
      {verifyError && (
        <div class="container" style="max-width: 420px;">
          <div class="alert alert-danger mt-4">✕ Sign-in failed: {verifyError}</div>
        </div>
      )}
      <LoginForm />
    </>
  );
}

const mount = document.getElementById("portal-app");
if (mount) render(<PortalApp />, mount);
