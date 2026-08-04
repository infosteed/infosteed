// SPDX-License-Identifier: AGPL-3.0-only
import type { ReactNode } from "react";
import {
  Archive,
  BookOpen,
  Clock3,
  FolderKanban,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Share2,
  ShieldCheck,
} from "lucide-react";
import type { BrandingSettings, CurrentUser } from "@infosteed/shared";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark, productLogoUrl } from "../BrandMark";
import { UserAvatar } from "./UserAvatar";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

const navItems = [
  { label: t("Library"), href: "/", icon: BookOpen },
  { label: t("Projects"), href: "/?scope=all", icon: FolderKanban },
  { label: t("Shared"), href: "/?scope=shared", icon: Share2 },
  { label: t("Recent"), href: "/?sort=recent", icon: Clock3 },
];

export function AppShell({
  user,
  branding,
  active = "library",
  collapsed,
  onCollapsedChange,
  onOpenAdmin,
  onOpenSecurity,
  onLogout,
  onLogoutAll,
  topbar,
  children,
  className,
}: {
  user: CurrentUser;
  branding?: BrandingSettings;
  active?: "library" | "recording" | "admin";
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onOpenAdmin?: () => void;
  onOpenSecurity?: () => void;
  onLogout?: () => void;
  onLogoutAll?: () => void;
  topbar?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const brandName = branding?.displayName || "InfoSteed";
  const brandIcon = branding?.iconDataUrl || productLogoUrl;

  return (
    <SidebarProvider>
      <main
        className={cn(
          "app-shell",
          collapsed && "app-shell-collapsed",
          className,
        )}
      >
        <Sidebar className="app-sidebar">
          <SidebarHeader>
            <div className="app-brand-row">
              <a className="app-brand" href="/">
                <BrandMark src={brandIcon} />
                <span>{brandName}</span>
              </a>
              <Button
                aria-label={
                  collapsed ? t("Expand sidebar") : t("Collapse sidebar")
                }
                size="icon"
                type="button"
                variant="ghost"
                onClick={() => onCollapsedChange(!collapsed)}
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </Button>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <nav className="app-nav" aria-label={t("Primary navigation")}>
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.label}
                    className={cn(
                      "app-nav-item",
                      active === "library" &&
                        item.label === t("Library") &&
                        "active",
                    )}
                    href={item.href}
                  >
                    <Icon className="size-4" />
                    <span>{item.label}</span>
                  </a>
                );
              })}
              {user.role === "admin" && onOpenAdmin && (
                <button
                  className={cn("app-nav-item", active === "admin" && "active")}
                  type="button"
                  onClick={onOpenAdmin}
                >
                  <Settings className="size-4" />
                  <span>{t("Administration")}</span>
                </button>
              )}
            </nav>
          </SidebarContent>
          <SidebarFooter>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="app-profile" type="button">
                  <UserAvatar name={user.displayName} />
                  <span>
                    <strong>{user.displayName}</strong>
                    <small>{t(user.role)}</small>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {onOpenSecurity && (
                  <DropdownMenuItem onSelect={onOpenSecurity}>
                    <ShieldCheck className="mr-2 size-4" />
                    {t("Security")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <a href="/?scope=trash">
                    <Archive className="mr-2 size-4" />
                    {t("Trash")}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {onLogout && (
                  <DropdownMenuItem onSelect={onLogout}>
                    <LogOut className="mr-2 size-4" />
                    {t("Log Out")}
                  </DropdownMenuItem>
                )}
                {onLogoutAll && (
                  <DropdownMenuItem onSelect={onLogoutAll}>
                    {t("Log Out All Sessions")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        <section className="app-main">
          {topbar && <div className="app-topbar">{topbar}</div>}
          <div className="app-content">{children}</div>
        </section>
      </main>
    </SidebarProvider>
  );
}
