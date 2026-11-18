"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import {
  CpuIcon,
  DumbbellIcon,
  FlameIcon,
  HomeIcon,
  LockIcon,
  PanelLeftIcon,
  RouteIcon,
} from "@/components/ui/Icons";
import { LiveIsland, LiveIslandProvider } from "@/components/ui/LiveIsland";

interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Home", shortLabel: "Home", icon: HomeIcon },
  { href: "/gym", label: "Gym", shortLabel: "Gym", icon: DumbbellIcon },
  { href: "/routes", label: "Routes", shortLabel: "Routes", icon: RouteIcon },
  { href: "/nutrition", label: "Nutrition", shortLabel: "Macros", icon: FlameIcon },
  { href: "/ai-engine", label: "AI Engine", shortLabel: "AI", icon: CpuIcon },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<boolean>(false);

  return (
    <LiveIslandProvider>
      <div className="min-h-screen bg-void text-ink-primary">
        <LiveIsland />

        <div className="mx-auto flex min-h-screen max-w-[1440px]">
          <aside
            aria-label="Navegación principal"
            className={`hidden shrink-0 border-r border-border-subtle bg-surface lg:flex lg:flex-col lg:justify-between ${
              collapsed ? "w-20" : "w-60"
            }`}
          >
            <div className="p-4 pt-6">
              <div
                className={`flex gap-2 ${
                  collapsed
                    ? "flex-col items-center"
                    : "flex-row items-center justify-between"
                }`}
              >
                <Link
                  href="/"
                  className="flex min-h-11 min-w-11 items-center justify-center gap-2.5 rounded-xl px-2 font-semibold tracking-tight text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-void text-xs font-bold tabular-nums">
                    PT
                  </span>
                  {collapsed ? (
                    <span className="sr-only">PulseTrack</span>
                  ) : (
                    <span className="text-sm">PulseTrack</span>
                  )}
                </Link>

                <button
                  type="button"
                  aria-label={collapsed ? "Expandir barra lateral" : "Colapsar barra lateral"}
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsed((prev) => !prev)}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-transparent text-ink-secondary pt-motion-gpu hover:border-border-strong hover:bg-elevated hover:text-ink-primary active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary"
                >
                  <PanelLeftIcon className="h-5 w-5" />
                </button>
              </div>

              <nav className="mt-6 flex flex-col gap-1.5" aria-label="Vistas del sistema">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-11 items-center rounded-xl px-3 text-sm font-medium pt-motion-gpu active:scale-[0.98] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary ${
                        collapsed ? "justify-center" : "gap-3"
                      } ${
                        active
                          ? "bg-ink-primary text-void"
                          : "text-ink-secondary hover:bg-elevated hover:text-ink-primary"
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="border-t border-border-subtle p-4">
              <Link
                href="/login"
                aria-current={pathname === "/login" ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-xl px-3 text-sm font-medium pt-motion-gpu active:scale-[0.98] motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-primary ${
                  collapsed ? "justify-center" : "gap-3"
                } ${
                  pathname === "/login"
                    ? "bg-ink-primary text-void"
                    : "text-ink-secondary hover:bg-elevated hover:text-ink-primary"
                }`}
              >
                <LockIcon className="h-5 w-5 shrink-0" />
                <span className={collapsed ? "sr-only" : "truncate"}>Acceso</span>
              </Link>
            </div>
          </aside>

          <main className="min-w-0 flex-1 px-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-[calc(4.75rem+env(safe-area-inset-top))] sm:px-6 lg:px-10 lg:pb-12">
            {children}
          </main>
        </div>

        <nav
          aria-label="Navegación inferior móvil"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border-subtle bg-void pb-[env(safe-area-inset-bottom)] lg:hidden"
        >
          <ul className="grid grid-cols-5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium pt-motion-gpu active:scale-95 motion-reduce:transform-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink-primary ${
                      active ? "text-ink-primary" : "text-ink-secondary hover:text-ink-primary"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span>{item.shortLabel}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </LiveIslandProvider>
  );
}
