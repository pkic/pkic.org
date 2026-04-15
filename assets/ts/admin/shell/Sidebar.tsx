import { type ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { authEmail, clearAuth } from "../state";

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
  { path: "/users", sec: "users", label: "Users", icon: "users" },
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

export function Sidebar() {
  const [location] = useHashLocation();
  const activeSec =
    location === "/" || location === ""
      ? "dashboard"
      : location.replace(/^\//, "").split("/")[0] === "email" && location.includes("/templates")
        ? "templates"
        : location.replace(/^\//, "").split("/")[0];

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
          onClick={() => {
            clearAuth();
            window.location.reload();
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
