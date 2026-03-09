"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Blocks,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  GitBranch,
  Globe2,
  Home,
  LayoutGrid,
  Menu,
  Radar,
  Search,
  SlidersHorizontal,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";

type ThemeMode = "blue" | "black";
type MobileSidebarMode = "hidden" | "icon" | "expanded";

const GOLD_THEME_STORAGE_KEY = "ivq_globe_gold_theme_v1";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "ivq_sidebar_collapsed_v1";
const MOBILE_SIDEBAR_MODE_STORAGE_KEY = "ivq_sidebar_mobile_mode_v1";
const MOBILE_BREAKPOINT_QUERY = "(max-width: 768px)";

type NavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  activePaths?: string[];
};

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Home",
    items: [{ id: "start", label: "Start", icon: Home, href: "/dashboard", activePaths: ["/home"] }],
  },
  {
    label: "Live Trading",
    items: [
      { id: "globe", label: "Globe", icon: Globe2, href: "/dashboard", activePaths: ["/dashboard"] },
      { id: "screener", label: "Screener", icon: Search, href: "/screener", activePaths: ["/screener"] },
      { id: "seasonality", label: "Seasonality", icon: TrendingUp, href: "/seasonality", activePaths: ["/seasonality"] },
      { id: "track_record", label: "Track Record", icon: Activity, href: "/track-record", activePaths: ["/track-record"] },
      { id: "edge_portfolio", label: "Edge Portfolio", icon: FolderKanban, href: "/edge-portfolio", activePaths: ["/edge-portfolio"] },
    ],
  },
  {
    label: "Engine",
    items: [
      { id: "engine", label: "Engine", icon: BarChart3 },
      { id: "optimizer", label: "Optimizer", icon: SlidersHorizontal },
      { id: "montecarlo", label: "Monte Carlo", icon: Blocks, href: "/monte-carlo", activePaths: ["/monte-carlo"] },
    ],
  },
  {
    label: "Market Analysis",
    items: [
      { id: "heatmap", label: "Heatmap", icon: LayoutGrid },
      { id: "correlation", label: "Correlation", icon: GitBranch },
      { id: "regime", label: "Regime", icon: Radar },
    ],
  },
];

function dispatchTheme(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  const goldEnabled = mode === "black";
  window.localStorage.setItem(GOLD_THEME_STORAGE_KEY, goldEnabled ? "1" : "0");
  document.body.classList.toggle("ivq-theme-gold", goldEnabled);
  window.dispatchEvent(
    new CustomEvent("invoria-theme-set", {
      detail: {
        theme: mode,
        themeCanonical: goldEnabled ? "black" : "blue",
      },
    }),
  );
}

function applySidebarWidth(collapsed: boolean): void {
  if (typeof document === "undefined") return;
  const width = collapsed ? "80px" : "240px";
  document.documentElement.style.setProperty("--ivq-sidebar-width", width);
  document.body.classList.toggle("ivq-sidebar-expanded", !collapsed);
}

function isItemActive(pathname: string, item: NavItem): boolean {
  return (item.activePaths ?? []).some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function parseMobileSidebarMode(value: string | null): MobileSidebarMode {
  return value === "icon" || value === "expanded" ? value : "hidden";
}

function nextMobileSidebarMode(mode: MobileSidebarMode): MobileSidebarMode {
  if (mode === "hidden") return "icon";
  if (mode === "icon") return "expanded";
  return "hidden";
}

export default function Sidebar() {
  const pathname = usePathname();
  const [theme, setTheme] = useState<ThemeMode>("blue");
  const [collapsed, setCollapsed] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileMode, setMobileMode] = useState<MobileSidebarMode>("hidden");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const goldStored = window.localStorage.getItem(GOLD_THEME_STORAGE_KEY) === "1";
    const nextTheme: ThemeMode = goldStored ? "black" : "blue";
    const storedCollapsed = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    const storedMobileMode = window.localStorage.getItem(MOBILE_SIDEBAR_MODE_STORAGE_KEY);
    const nextCollapsed = storedCollapsed == null ? true : storedCollapsed === "1";
    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const legacyMediaQuery = mediaQuery as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    const syncMobile = (matches: boolean) => {
      setIsMobile(matches);
    };

    setTheme(nextTheme);
    setCollapsed(nextCollapsed);
    setMobileMode(parseMobileSidebarMode(storedMobileMode));
    document.body.classList.toggle("ivq-theme-gold", goldStored);
    syncMobile(mediaQuery.matches);

    const onMediaChange = (event: MediaQueryListEvent) => {
      syncMobile(event.matches);
    };

    const onThemeEvent = (event: Event) => {
      const custom = event as CustomEvent<{ theme?: string; themeCanonical?: string }>;
      const canonical = String(custom.detail?.themeCanonical || "").toLowerCase();
      const legacy = String(custom.detail?.theme || "").toLowerCase();
      if (canonical === "blue" || legacy === "blue") {
        setTheme("blue");
        return;
      }
      if (canonical === "black" || legacy === "black" || legacy === "gold") {
        setTheme("black");
      }
    };

    if ("addEventListener" in mediaQuery) {
      mediaQuery.addEventListener("change", onMediaChange);
    } else {
      legacyMediaQuery.addListener?.(onMediaChange);
    }
    window.addEventListener("invoria-theme-set", onThemeEvent as EventListener);

    return () => {
      if ("removeEventListener" in mediaQuery) {
        mediaQuery.removeEventListener("change", onMediaChange);
      } else {
        legacyMediaQuery.removeListener?.(onMediaChange);
      }
      window.removeEventListener("invoria-theme-set", onThemeEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
    if (isMobile) return;
    applySidebarWidth(collapsed);
  }, [collapsed, isMobile]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MOBILE_SIDEBAR_MODE_STORAGE_KEY, mobileMode);
    if (isMobile) {
      document.documentElement.style.setProperty("--ivq-sidebar-width", "0px");
      document.body.classList.add("ivq-mobile-sidebar-active");
      document.body.classList.toggle("ivq-mobile-sidebar-expanded", mobileMode === "expanded");
      document.body.classList.toggle("ivq-sidebar-expanded", false);
      return;
    }
    document.body.classList.remove("ivq-mobile-sidebar-active", "ivq-mobile-sidebar-expanded");
    applySidebarWidth(collapsed);
  }, [collapsed, isMobile, mobileMode]);

  const onThemeClick = (mode: ThemeMode) => {
    setTheme(mode);
    dispatchTheme(mode);
  };

  const handleNavActivate = () => {
    if (!isMobile) return;
    setMobileMode("hidden");
  };

  const logoAsset = useMemo(
    () => (
      theme === "black"
        ? {
            full: "/CAPITALIFE_Logo.png",
            icon: "/capitalife_icon.png",
            alt: "Capitalife",
          }
        : {
            full: "/invoria_logo.png",
            icon: "/invoria_icon.png",
            alt: "Invoria Quant",
          }
    ),
    [theme],
  );

  return (
    <>
      <button
        type="button"
        className="ivq-mobile-sidebar-toggle"
        onClick={() => setMobileMode((value) => nextMobileSidebarMode(value))}
        aria-label="Toggle mobile sidebar"
        title="Toggle mobile sidebar"
      >
        <Menu size={18} strokeWidth={2} />
      </button>

      {isMobile && mobileMode === "expanded" ? (
        <button
          type="button"
          className="ivq-mobile-sidebar-backdrop"
          onClick={() => setMobileMode("hidden")}
          aria-label="Close mobile sidebar"
        />
      ) : null}

      <aside
        className={`ivq-sidebar ${collapsed ? "is-collapsed" : "is-expanded"} ${isMobile ? `is-mobile is-mobile-${mobileMode}` : ""}`}
        aria-label="Primary sidebar"
      >
        <div className="ivq-sidebar-top">
          <button
            type="button"
            className="ivq-sidebar-collapse-btn"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronLeft size={14} strokeWidth={2} />}
          </button>

          <div className="ivq-sidebar-logo-wrap">
            <img
              src={collapsed && !isMobile ? logoAsset.icon : logoAsset.full}
              alt={logoAsset.alt}
              className={`ivq-sidebar-logo-image ${collapsed && !isMobile ? "is-icon" : "is-full"}`}
            />
          </div>
        </div>

        <nav className="ivq-sidebar-nav" aria-label="Primary">
          {navGroups.map((group) => (
            <section key={group.label} className="ivq-sidebar-group">
              <h2 className="ivq-sidebar-group-title">{group.label}</h2>
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isItemActive(pathname, item);
                const commonProps = {
                  className: `ivq-sidebar-item ${active ? "is-active" : ""}`,
                  title: item.label,
                  "aria-current": active ? "page" : undefined,
                } as const;

                if (item.href) {
                  return (
                    <Link key={item.id} href={item.href} prefetch scroll={false} onClick={handleNavActivate} {...commonProps}>
                      <Icon size={17} strokeWidth={1.85} />
                      <span>{item.label}</span>
                    </Link>
                  );
                }

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={handleNavActivate}
                    {...commonProps}
                  >
                    <Icon size={17} strokeWidth={1.85} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </section>
          ))}
        </nav>

        <div className="ivq-sidebar-theme">
          <h2 className="ivq-sidebar-group-title ivq-sidebar-theme-title">Theme</h2>
          <div className="ivq-sidebar-theme-grid">
            <button
              type="button"
              className={`ivq-theme-btn ${theme === "blue" ? "is-active" : ""}`}
              onClick={() => onThemeClick("blue")}
              title="Light Blue"
            >
              <span className="ivq-theme-btn-label">Light Blue</span>
              <span className="ivq-theme-btn-short">
                <span className="ivq-theme-btn-dot is-blue" />
              </span>
            </button>
            <button
              type="button"
              className={`ivq-theme-btn ${theme === "black" ? "is-active" : ""}`}
              onClick={() => onThemeClick("black")}
              title="Dark Gold"
            >
              <span className="ivq-theme-btn-label">Dark Gold</span>
              <span className="ivq-theme-btn-short">
                <span className="ivq-theme-btn-dot is-gold" />
              </span>
            </button>
          </div>
        </div>

        <div className="ivq-sidebar-spacer" />
      </aside>
    </>
  );
}
