/**
 * AppTabBar — the installed portal's bottom navigation on phones.
 *
 * One component for both scopes the app has: the portal-wide tabs the shell
 * always renders, and an event's own tabs that participant event pages render
 * while the reader is inside an event. Only one is ever visible: an event bar
 * on the page hides the portal bar (see AppTabBar.css), so no route table has
 * to predict which pages own an event bar.
 *
 * Desktop keeps the sidebar and each page's own top tabs; the bar is hidden
 * above the phone breakpoint, which also removes it from the accessibility
 * tree there. Tabs are real links marked with `aria-current="page"`, the same
 * contract as `Tabs`.
 *
 * A bar may end in a menu tab: a button that opens a sheet of everything the
 * tabs leave out. Swiping up on the bar opens the same sheet.
 */
import { APP_ICONS, type AppIcon } from "../../../components/icons/app-navigation";
import { useVerticalSwipe } from "../../../ui/use-vertical-swipe";
import "./AppTabBar.css";

export type AppTabIcon = AppIcon;

export interface AppTab {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon?: AppTabIcon;
}

/** The trailing tab that opens a sheet instead of a page. */
export interface AppTabMenu {
  readonly id: string;
  readonly label: string;
  readonly icon: AppTabIcon;
  /** The id of the sheet it opens. */
  readonly controls: string;
  readonly expanded: boolean;
  readonly onOpen: () => void;
}

function TabContent({ label, icon }: { label: string; icon?: AppTabIcon }) {
  const Icon = icon ? APP_ICONS[icon] : null;
  return (
    <>
      {/* The glyph above a tab's label is decorative, since the label is the tab's name. */}
      {Icon && <Icon class="pk-app-tabbar__icon" width="22" height="22" />}
      <span class="pk-app-tabbar__label">{label}</span>
    </>
  );
}

export function AppTabBar({
  items,
  activeId,
  label,
  scope,
  menu,
}: {
  items: readonly AppTab[];
  activeId?: string;
  label: string;
  scope: "portal" | "event";
  menu?: AppTabMenu;
}) {
  const swipe = useVerticalSwipe({ direction: "up", onSwipe: () => menu?.onOpen() });
  if (items.length + (menu ? 1 : 0) < 2) return null;
  return (
    <div
      class={`pk-app-tabbar pk-app-tabbar--${scope}${menu ? " pk-app-tabbar--swipeable" : ""}`}
      {...(menu ? swipe : {})}
    >
      <nav aria-label={label}>
        <ul class="pk-app-tabbar__list">
          {items.map((item) => (
            <li key={item.id} class="pk-app-tabbar__item">
              <a
                class="pk-app-tabbar__link"
                href={item.href}
                data-app-tab={item.id}
                aria-current={item.id === activeId ? "page" : undefined}
              >
                <TabContent label={item.label} icon={item.icon} />
              </a>
            </li>
          ))}
          {menu && (
            <li class="pk-app-tabbar__item">
              <button
                type="button"
                class="pk-app-tabbar__link"
                data-app-tab={menu.id}
                aria-haspopup="dialog"
                aria-expanded={menu.expanded}
                aria-controls={menu.controls}
                // The open page is one of the menu's destinations.
                aria-current={menu.id === activeId ? "page" : undefined}
                onClick={menu.onOpen}
              >
                <TabContent label={menu.label} icon={menu.icon} />
              </button>
            </li>
          )}
        </ul>
      </nav>
    </div>
  );
}
