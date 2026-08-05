// SPDX-License-Identifier: AGPL-3.0-only
import { useState, type ReactNode } from "react";
import {
  Archive,
  BookOpen,
  FolderKanban,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Share2,
  ShieldCheck,
  Sun,
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark, productLogoUrl } from "../BrandMark";
import { UserAvatar } from "./UserAvatar";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { updateMyPreferences } from "@/api";
import { toast } from "@/components/ui/sonner";
import { isThemePreference, useTheme } from "@/theme";

export type AppShellNavKey =
  "library" | "projects" | "shared" | "trash" | "admin" | "recording";

const navItems: Array<{
  key: AppShellNavKey;
  label: string;
  href: string;
  icon: typeof BookOpen;
}> = [
  { key: "library", label: t("Library"), href: "/", icon: BookOpen },
  {
    key: "projects",
    label: t("Projects"),
    href: "/?library=projects&scope=owned",
    icon: FolderKanban,
  },
  {
    key: "shared",
    label: t("Shared"),
    href: "/?library=shared&scope=shared",
    icon: Share2,
  },
  {
    key: "trash",
    label: t("Trash"),
    href: "/?library=trash&scope=trash",
    icon: Archive,
  },
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
  active?: AppShellNavKey;
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
  const { preference, setPreference } = useTheme();
  const [savingTheme, setSavingTheme] = useState(false);
  const brandName = branding?.displayName || "InfoSteed";
  const brandIcon = branding?.iconDataUrl || productLogoUrl;

  async function changeTheme(next: string) {
    if (!isThemePreference(next) || savingTheme || next === preference) return;
    const previous = preference;
    setSavingTheme(true);
    setPreference(next);
    try {
      const result = await updateMyPreferences(next);
      setPreference(result.user.themePreference);
    } catch {
      setPreference(previous);
      toast.error(t("Could not save appearance preference."));
    } finally {
      setSavingTheme(false);
    }
  }

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
          <SidebarHeader className="app-sidebar-header">
            <div className="app-brand-row">
              <a className="app-brand" href="/">
                <BrandMark src={brandIcon} />
                <span>{brandName}</span>
              </a>
              <Button
                className="app-sidebar-toggle"
                aria-label={
                  collapsed ? t("Expand sidebar") : t("Collapse sidebar")
                }
                title={collapsed ? t("Expand sidebar") : t("Collapse sidebar")}
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
                    aria-label={item.label}
                    className={cn(
                      "app-nav-item",
                      active === item.key && "active",
                    )}
                    href={item.href}
                    aria-current={active === item.key ? "page" : undefined}
                    title={item.label}
                  >
                    <Icon className="size-4" />
                    <span>{item.label}</span>
                  </a>
                );
              })}
            </nav>
          </SidebarContent>
          <SidebarFooter className="app-sidebar-footer">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={t("Account menu for {name}", {
                    name: user.displayName,
                  })}
                  className="app-profile"
                  title={user.displayName}
                  type="button"
                >
                  <UserAvatar name={user.displayName} />
                  <span>
                    <strong>{user.displayName}</strong>
                    <small>{t(user.role)}</small>
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="app-account-menu w-56"
                side={collapsed ? "right" : "top"}
              >
                {user.role === "admin" && onOpenAdmin && (
                  <DropdownMenuItem onSelect={onOpenAdmin}>
                    <Settings className="size-4" />
                    {t("Administration")}
                  </DropdownMenuItem>
                )}
                {onOpenSecurity && (
                  <DropdownMenuItem onSelect={onOpenSecurity}>
                    <ShieldCheck className="size-4" />
                    {t("Security")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2.5 py-1.5 text-xs font-semibold text-muted-foreground">
                  {t("Appearance")}
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={preference}
                  onValueChange={(value) => void changeTheme(value)}
                >
                  <DropdownMenuRadioItem value="light" disabled={savingTheme}>
                    <Sun />
                    {t("Light")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dark" disabled={savingTheme}>
                    <Moon />
                    {t("Dark")}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="system" disabled={savingTheme}>
                    <Monitor />
                    {t("System")}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {onLogout && (
                  <DropdownMenuItem onSelect={onLogout}>
                    <LogOut className="size-4" />
                    {t("Log Out")}
                  </DropdownMenuItem>
                )}
                {onLogoutAll && (
                  <DropdownMenuItem onSelect={onLogoutAll}>
                    <LogOut className="size-4" />
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
