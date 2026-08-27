import { type ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { authEmail, clearAuth } from "../state";
import { apiCommand } from "../api";

/* ── SVG icon helpers (Bootstrap Icons, 16×16) ──────────────────────────── */

function Icon({ children }: { children: ComponentChildren }) {
  return <span class="icon">{children}</span>;
}

const icons = {
  dashboard: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M0 1.5A1.5 1.5 0 0 1 1.5 0h2A1.5 1.5 0 0 1 5 1.5v2A1.5 1.5 0 0 1 3.5 5h-2A1.5 1.5 0 0 1 0 3.5zM1.5 1a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5zM0 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm1 3v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2zm14-1V8a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v2zM2 8.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5m0 4a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5" />
    </svg>
  ),
  events: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M3.5 0a.5.5 0 0 1 .5.5V1h8V.5a.5.5 0 0 1 1 0V1h1a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h1V.5a.5.5 0 0 1 .5-.5M1 4v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4z" />
    </svg>
  ),
  email: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm2-1a1 1 0 0 0-1 1v.217l7 4.2 7-4.2V4a1 1 0 0 0-1-1zm13 2.383-4.708 2.825L15 11.105zm-.034 6.876-5.64-3.471L8 9.583l-1.326-.795-5.64 3.47A1 1 0 0 0 2 13h12a1 1 0 0 0 .966-.741M1 11.105l4.708-2.897L1 5.383z" />
    </svg>
  ),
  duework: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71z" />
      <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16m7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0" />
    </svg>
  ),
  templates: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z" />
    </svg>
  ),
  forms: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M5.5 7a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1zm0 2a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1zm0 2a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1z" />
      <path d="M9.5 0H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5zm0 1v2A1.5 1.5 0 0 0 11 4.5h2V14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" />
    </svg>
  ),
  stats: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M4 11H2v3h2zm5-4H7v7h2zm5-5h-2v12h2zm-2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1zM6 7a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zm-5 4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" />
    </svg>
  ),
  donations: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path fill-rule="evenodd" d="M8 1.314C12.438-3.248 23.534 4.735 8 15-7.534 4.736 3.562-3.248 8 1.314" />
    </svg>
  ),
  users: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M15 14s1 0 1-1-1-4-5-4-5 3-5 4 1 1 1 1zm-7.978-1L7 12.996c.001-.264.167-1.03.76-1.72C8.312 10.629 9.282 10 11 10c1.717 0 2.687.63 3.24 1.276.593.69.758 1.457.76 1.72l-.008.002-.014.002zM11 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4m3-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0M6.936 9.28a6 6 0 0 0-1.23-.247A7 7 0 0 0 5 9c-4 0-5 3-5 4s1 1 1 1h4.216A2.24 2.24 0 0 1 5 13c0-1.01.377-2.042 1.09-2.904.243-.294.526-.569.846-.816M4.92 10A5.5 5.5 0 0 0 4 13H1c0-.26.164-1.03.76-1.724.545-.636 1.492-1.256 3.16-1.275ZM1.5 5.5a3 3 0 1 1 6 0 3 3 0 0 1-6 0m3-2a2 2 0 1 0 0 4 2 2 0 0 0 0-4" />
    </svg>
  ),
  auditlog: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M5 10.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5" />
      <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-1h1v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v1H1V2a2 2 0 0 1 2-2" />
      <path d="M1 5v-.5a.5.5 0 0 1 1 0V5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0V8h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0v.5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1z" />
    </svg>
  ),
  organizations: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M4 2.5a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5m0 3a.5.5 0 0 1 .5-.5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1-.5-.5M4.5 8a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1zm0 3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1z" />
      <path d="M2 1a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v14h1.5a.5.5 0 0 1 0 1h-15a.5.5 0 0 1 0-1H2zm10 13V1H3v13z" />
    </svg>
  ),
  accesscontrol: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M5.338 1.59a61 61 0 0 0-2.837.856.48.48 0 0 0-.328.39c-.554 4.157.726 7.19 2.253 9.188a10.7 10.7 0 0 0 2.287 2.233c.346.244.652.42.893.533.12.06.218.098.293.118a1 1 0 0 0 .101.025 1 1 0 0 0 .1-.025c.075-.02.174-.057.294-.118.24-.113.547-.29.893-.533a10.7 10.7 0 0 0 2.287-2.233c1.527-1.997 2.807-5.031 2.253-9.188a.48.48 0 0 0-.328-.39c-.651-.213-1.75-.56-2.837-.855C9.552 1.29 8.531 1 8 1c-.531 0-1.552.29-2.662.59Zm-.443 1.284c1.078-.292 2.04-.545 2.605-.545.565 0 1.527.253 2.605.545a61 61 0 0 1 2.588.795c.13 3.696-.994 6.31-2.324 8.08a9.7 9.7 0 0 1-2.06 2.024c-.301.213-.556.363-.746.462l-.063.032-.063-.032a8.4 8.4 0 0 1-.746-.462 9.7 9.7 0 0 1-2.06-2.024C3.501 9.925 2.377 7.31 2.507 3.615a61 61 0 0 1 2.588-.795Z" />
      <path d="M9.5 6.5a1.5 1.5 0 0 1-1 1.415l.385 1.99a.5.5 0 0 1-.491.595h-.788a.5.5 0 0 1-.49-.595l.384-1.99a1.5 1.5 0 1 1 2-1.415" />
    </svg>
  ),
  account: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.46 1.46 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.46 1.46 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.46 1.46 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.46 1.46 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.46 1.46 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.46 1.46 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.46 1.46 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z" />
    </svg>
  ),
  workinggroups: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M7 14s-1 0-1-1 1-4 5-4 5 3 5 4-1 1-1 1zm4-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6m-5.784 6A2.24 2.24 0 0 1 5 13c0-1.01.377-2.042 1.09-2.904A5 5 0 0 0 5 10c-4 0-5 3-5 4s1 1 1 1zM4.5 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5" />
    </svg>
  ),
  leadership: (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
      <path d="M12 4a1 1 0 1 1-2 0 1 1 0 0 1 2 0m-3.5 2.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3M3 4a1 1 0 1 1-2 0 1 1 0 0 1 2 0" />
      <path d="M2 5a1.5 1.5 0 0 0-1.5 1.5v3A1.5 1.5 0 0 0 2 11h1v3.5a.5.5 0 0 0 1 0V11h1a1.5 1.5 0 0 0 1.5-1.5v-3A1.5 1.5 0 0 0 5 5zm6.5 1a1.5 1.5 0 0 0-1.5 1.5v3A1.5 1.5 0 0 0 8.5 12h.5v2.5a.5.5 0 0 0 1 0V12h.5v2.5a.5.5 0 0 0 1 0V12h.5a1.5 1.5 0 0 0 1.5-1.5v-3A1.5 1.5 0 0 0 12 6z" />
    </svg>
  ),
  chevron: (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
      <path
        fill-rule="evenodd"
        d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"
      />
    </svg>
  ),
} as const;

/* ── Navigation structure ────────────────────────────────────────────────── */

interface NavItem {
  path: string;
  sec: string;
  label: string;
  icon: keyof typeof icons;
  children?: NavItem[];
}

export const NAV_ITEMS: NavItem[] = [
  { path: "/", sec: "dashboard", label: "Dashboard", icon: "dashboard" },
  { path: "/events", sec: "events", label: "Events", icon: "events" },
  { path: "/forms", sec: "forms", label: "Forms", icon: "forms" },
  {
    path: "/email",
    sec: "email",
    label: "Email",
    icon: "email",
    children: [{ path: "/email/templates", sec: "templates", label: "Templates", icon: "templates" }],
  },
  { path: "/duework", sec: "duework", label: "Due Work", icon: "duework" },
  { path: "/stats", sec: "stats", label: "Stats", icon: "stats" },
  { path: "/donations", sec: "donations", label: "Donations", icon: "donations" },
  {
    path: "/membership",
    sec: "membership",
    label: "Membership",
    icon: "users",
    children: [
      { path: "/membership/applications", sec: "membership-applications", label: "Applications", icon: "forms" },
      { path: "/membership/settings", sec: "membership-settings", label: "Settings", icon: "duework" },
    ],
  },
  { path: "/users", sec: "users", label: "Users", icon: "users" },
  {
    path: "/organizations",
    sec: "organizations",
    label: "Organizations",
    icon: "organizations",
    children: [
      {
        path: "/organizations/content-reviews",
        sec: "organizations-content-reviews",
        label: "Content Review",
        icon: "organizations",
      },
    ],
  },
  { path: "/sponsorships", sec: "sponsorships", label: "Sponsorships", icon: "donations" },
  { path: "/leadership", sec: "leadership", label: "Leadership", icon: "leadership" },
  { path: "/access-control", sec: "access-control", label: "Access Control", icon: "accesscontrol" },
  { path: "/auditlog", sec: "auditlog", label: "Audit Log", icon: "auditlog" },
];

function closeSidebar() {
  document.getElementById("admin-sidebar")?.classList.remove("open");
  document.getElementById("sidebar-backdrop")?.classList.remove("active");
  document.getElementById("sidebar-toggle")?.setAttribute("aria-expanded", "false");
}

/** Check if any item or child matches the active section */
function isActive(item: NavItem, activeSec: string): boolean {
  if (item.sec === activeSec) return true;
  return item.children?.some((c) => c.sec === activeSec) ?? false;
}

function NavLink({ item, activeSec }: { item: NavItem; activeSec: string }) {
  const [open, setOpen] = useState(() => isActive(item, activeSec));
  const hasChildren = item.children && item.children.length > 0;
  const active = item.sec === activeSec;
  const parentActive = isActive(item, activeSec);

  // auto-expand when a child becomes active
  if (parentActive && !open) setOpen(true);

  if (!hasChildren) {
    return (
      <Link href={item.path} class={`sidebar-link${active ? " active" : ""}`} onClick={closeSidebar}>
        <Icon>{icons[item.icon]}</Icon>
        {item.label}
      </Link>
    );
  }

  return (
    <div class={`sidebar-group${parentActive ? " active" : ""}`}>
      <Link
        href={item.path}
        class={`sidebar-link${active ? " active" : ""}`}
        onClick={(_e: MouseEvent) => {
          closeSidebar();
        }}
      >
        <Icon>{icons[item.icon]}</Icon>
        {item.label}
        <button
          type="button"
          class={`sidebar-chevron${open ? " open" : ""}`}
          onClick={(e: MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(!open);
          }}
          aria-label={open ? "Collapse" : "Expand"}
        >
          {icons.chevron}
        </button>
      </Link>
      {open && (
        <div class="sidebar-children">
          {item.children!.map((child) => (
            <Link
              key={child.sec}
              href={child.path}
              class={`sidebar-link sidebar-link-child${child.sec === activeSec ? " active" : ""}`}
              onClick={closeSidebar}
            >
              <Icon>{icons[child.icon]}</Icon>
              {child.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function activeSectionFor(location: string): string {
  if (location === "/" || location === "") return "dashboard";
  const top = location.replace(/^\//, "").split("/")[0];
  if (top === "email" && location.includes("/templates")) return "templates";
  if (top === "membership" && location.includes("/applications")) return "membership-applications";
  if (top === "membership" && location.includes("/settings")) return "membership-settings";
  return top;
}

export function Sidebar() {
  const [location] = useHashLocation();
  const activeSec = activeSectionFor(location);

  return (
    <aside id="admin-sidebar" class="p-2">
      <div class="px-2 py-3 mb-1">
        <div class="adm-brand">Admin Console</div>
        <div id="sb-user">{authEmail.value ?? ""}</div>
      </div>
      {NAV_ITEMS.map((item) => (
        <NavLink key={item.sec} item={item} activeSec={activeSec} />
      ))}
      <div class="adm-sidebar-footer px-1 pt-3">
        <button
          class="btn btn-sm btn-outline-secondary w-100"
          onClick={async () => {
            try {
              await apiCommand("/api/v1/admin/auth/logout", { method: "POST" });
            } finally {
              clearAuth();
              window.location.assign("/admin/");
            }
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
