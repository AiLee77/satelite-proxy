import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type { NavKey } from "../types";
import { UiModeMenu } from "../ui/UiModeMenu";
import { ThemeSwitch } from "./ThemeSwitch";
import "./SideNav.css";

const COMPACT_QUERY = "(max-width: 1100px)";

type LucideIconName = "layout-grid" | "waypoints" | "layers" |
  "chart-column" | "scroll-text" | "settings";

/** Official Lucide SVG children, from lucide-icons/lucide@c1a02a0.
 *  Icon paths are inlined: no runtime icon package or network dependency.
 *  ISC license: docs/lucide-icons-LICENSE.txt. */
const LUCIDE_ICONS: Record<LucideIconName, ReactNode> = {
  "layout-grid": <>
    <rect width="7" height="7" x="3" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="3" rx="1" />
    <rect width="7" height="7" x="14" y="14" rx="1" />
    <rect width="7" height="7" x="3" y="14" rx="1" />
  </>,
  waypoints: <>
    <path d="m10.586 5.414-5.172 5.172" />
    <path d="m18.586 13.414-5.172 5.172" />
    <path d="M6 12h12" />
    <circle cx="12" cy="20" r="2" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="20" cy="12" r="2" />
    <circle cx="4" cy="12" r="2" />
  </>,
  layers: <>
    <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
    <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
    <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
  </>,
  "chart-column": <>
    <path d="M3 3v16a2 2 0 0 0 2 2h16" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </>,
  "scroll-text": <>
    <path d="M15 12h-5" />
    <path d="M15 8h-5" />
    <path d="M19 17V5a2 2 0 0 0-2-2H4" />
    <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
  </>,
  settings: <>
    <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
    <circle cx="12" cy="12" r="3" />
  </>,
};

const ITEMS: { key: NavKey; labelKey: MessageKey; icon: LucideIconName }[] = [
  { key: "dashboard", labelKey: "dashboard.title", icon: "layout-grid" },
  { key: "nodes", labelKey: "nodes.title", icon: "waypoints" },
  { key: "config", labelKey: "config.title", icon: "layers" },
  { key: "traffic", labelKey: "traffic.title", icon: "chart-column" },
  { key: "logs", labelKey: "logs.title", icon: "scroll-text" },
  { key: "settings", labelKey: "settings.title", icon: "settings" },
];

interface Props {
  active: NavKey;
  onChange: (key: NavKey) => void;
}

export function SideNav({ active, onChange }: Props) {
  const { t } = useI18n();
  const navId = useId();
  const [collapsed, setCollapsed] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  const itemRefs = useRef<Partial<Record<NavKey, HTMLButtonElement>>>({});
  const navRef = useRef<HTMLElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorLayout = useRef<{
    active: NavKey; collapsed: boolean; navWidth: number; navHeight: number;
    x: number; y: number; width: number; height: number;
  } | null>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const indicator = indicatorRef.current;
    const selected = itemRefs.current[active];
    if (!nav || !indicator || !selected) return;

    const measure = (allowMotion: boolean, force = false) => {
      // nav 是 offsetParent；坐标属于滚动内容，不减 scrollTop。
      const next = {
        active, collapsed, navWidth: nav.clientWidth, navHeight: nav.clientHeight,
        x: selected.offsetLeft, y: selected.offsetTop,
        width: selected.offsetWidth, height: selected.offsetHeight,
      };
      const previous = indicatorLayout.current;
      if (!force && previous && Object.keys(next).every(key =>
        next[key as keyof typeof next] === previous[key as keyof typeof next])) return;
      const animate = allowMotion && document.documentElement.dataset.motionReduced !== "true"
        && previous && previous.active !== active
        && previous.collapsed === collapsed
        && previous.navWidth === next.navWidth && previous.navHeight === next.navHeight
        && previous.width === next.width && previous.height === next.height;
      indicator.dataset.motion = animate ? "true" : "false";
      indicator.style.width = `${next.width}px`;
      indicator.style.height = `${next.height}px`;
      indicator.style.transform = `translate(${next.x}px, ${next.y}px)`;
      nav.dataset.indicatorReady = "true";
      indicatorLayout.current = next;
    };

    measure(true);
    const observer = new ResizeObserver(() => measure(false));
    observer.observe(nav);
    // 字体、语言和折叠导致任一按钮尺寸变化时，立即重新对齐。
    for (const item of Object.values(itemRefs.current)) {
      if (item) observer.observe(item);
    }
    const onResize = () => measure(false);
    window.addEventListener("resize", onResize);
    // 模式或系统偏好变化时，取消在途过渡并直接吸附当前按钮。
    const motionObserver = new MutationObserver(() => measure(false, true));
    motionObserver.observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-ui-motion", "data-motion-reduced"],
    });
    return () => {
      observer.disconnect();
      motionObserver.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [active, collapsed]);

  useEffect(() => {
    const media = window.matchMedia(COMPACT_QUERY);
    const onResize = () => setCollapsed(media.matches);
    media.addEventListener("change", onResize);
    return () => media.removeEventListener("change", onResize);
  }, []);

  function onNavKeyDown(event: KeyboardEvent<HTMLElement>) {
    const index = ITEMS.findIndex(item => itemRefs.current[item.key] === event.target);
    if (index < 0) return;
    let next: number;
    switch (event.key) {
      case "ArrowDown": next = (index + 1) % ITEMS.length; break;
      case "ArrowUp": next = (index + ITEMS.length - 1) % ITEMS.length; break;
      case "Home": next = 0; break;
      case "End": next = ITEMS.length - 1; break;
      default: return;
    }
    event.preventDefault();
    itemRefs.current[ITEMS[next].key]?.focus();
  }

  return (
    <aside className="side-nav" data-collapsed={collapsed}>
      <div className="side-nav-head">
        <div className="side-nav-brand" title="Satelite">
          <span className="side-nav-mark" aria-hidden="true">◈</span>
          <span className="side-nav-brand-text">SATELITE</span>
        </div>
        <button
          type="button"
          className="side-nav-toggle icon-btn"
          aria-label={t("uiMenu.proMode")}
          title={t("uiMenu.proMode")}
          aria-expanded={!collapsed}
          aria-controls={navId}
          onClick={() => setCollapsed(value => !value)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" focusable="false">
            <path d="M4 4h16v16H4z M9 4v16" />
            <path d={collapsed ? "m12 9 3 3-3 3" : "m16 9-3 3 3 3"} />
          </svg>
        </button>
      </div>
      <nav ref={navRef} id={navId} className="side-nav-items" aria-label={t("uiMenu.proMode")} onKeyDown={onNavKeyDown}>
        <span ref={indicatorRef} className="side-nav-indicator" aria-hidden="true" />
        {ITEMS.map(item => (
          <button
            key={item.key}
            ref={element => { itemRefs.current[item.key] = element ?? undefined; }}
            type="button"
            className={`side-nav-item nav-item${active === item.key ? " active" : ""}`}
            aria-label={t(item.labelKey)}
            aria-current={active === item.key ? "page" : undefined}
            title={t(item.labelKey)}
            onClick={() => onChange(item.key)}
          >
            <svg
              data-lucide={item.icon}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              {LUCIDE_ICONS[item.icon]}
            </svg>
            <span className="side-nav-label">{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>
      <div className="side-nav-tools">
        <ThemeSwitch />
        <UiModeMenu />
      </div>
    </aside>
  );
}
