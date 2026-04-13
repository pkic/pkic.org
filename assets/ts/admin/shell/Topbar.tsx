import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";

export function Topbar() {
  const backdropRef = useRef<HTMLDivElement | null>(null);

  function toggleSidebar() {
    const sidebar = document.getElementById("admin-sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    const toggle = document.getElementById("sidebar-toggle");
    const isOpen = sidebar?.classList.toggle("open");
    backdrop?.classList.toggle("active", isOpen);
    toggle?.setAttribute("aria-expanded", String(isOpen));
  }

  function closeSidebar() {
    document.getElementById("admin-sidebar")?.classList.remove("open");
    document.getElementById("sidebar-backdrop")?.classList.remove("active");
    document.getElementById("sidebar-toggle")?.setAttribute("aria-expanded", "false");
  }

  useEffect(() => {
    const backdrop = document.getElementById("sidebar-backdrop");
    backdrop?.addEventListener("click", closeSidebar);
    return () => backdrop?.removeEventListener("click", closeSidebar);
  }, []);

  return (
    <div id="admin-topbar">
      <button
        id="sidebar-toggle"
        aria-label="Toggle navigation"
        aria-expanded="false"
        aria-controls="admin-sidebar"
        onClick={toggleSidebar}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
          <path fill-rule="evenodd" d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5" />
        </svg>
      </button>
      <span class="adm-brand">Admin Console</span>
    </div>
  );
}
