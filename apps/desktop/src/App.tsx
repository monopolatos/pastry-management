import { useEffect, useState } from "react";
import {
  Calculator,
  ChefHat,
  CircleUser,
  DatabaseBackup,
  LayoutDashboard,
  LogOut,
  Settings as SettingsIcon,
  Tags,
  Truck,
  Users as UsersIcon,
  Wheat,
} from "lucide-react";
import * as authApi from "./api/auth";
import { AuthScreen } from "./components/auth/AuthScreen";
import { BackupScreen } from "./components/backup/BackupScreen";
import { CategoriesScreen } from "./components/categories/CategoriesScreen";
import { CostCalculatorScreen } from "./components/costCalculator/CostCalculatorScreen";
import { DashboardScreen } from "./components/dashboard/DashboardScreen";
import { ProfileScreen } from "./components/profile/ProfileScreen";
import { RawMaterialsScreen } from "./components/rawMaterials/RawMaterialsScreen";
import { RecipesScreen } from "./components/recipes/RecipesScreen";
import { SettingsScreen } from "./components/settings/SettingsScreen";
import { SuppliersScreen } from "./components/suppliers/SuppliersScreen";
import { UsersSection } from "./components/users/UsersSection";
import { Avatar, AvatarFallback } from "./components/ui/avatar";
import { Button } from "./components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "./components/ui/sidebar";
import { useI18n } from "./lib/i18n";
import type { TranslationKey } from "./lib/i18n";
import { USER_ROLE_LABEL_KEYS } from "./api/types";
import type { SessionInfo } from "./api/types";

type Tab =
  | "dashboard"
  | "raw-materials"
  | "suppliers"
  | "recipes"
  | "categories"
  | "cost-calculator"
  | "backup"
  | "settings"
  | "profile"
  | "users";

interface NavItem {
  tab: Tab;
  labelKey: TranslationKey;
  icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { tab: "dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { tab: "raw-materials", labelKey: "nav.rawMaterials", icon: Wheat },
  { tab: "suppliers", labelKey: "nav.suppliers", icon: Truck },
  { tab: "recipes", labelKey: "nav.recipes", icon: ChefHat },
  { tab: "categories", labelKey: "nav.categories", icon: Tags },
  { tab: "cost-calculator", labelKey: "nav.costCalculator", icon: Calculator },
  { tab: "backup", labelKey: "nav.backup", icon: DatabaseBackup },
  { tab: "settings", labelKey: "nav.settings", icon: SettingsIcon },
  { tab: "profile", labelKey: "nav.profile", icon: CircleUser },
];

function initials(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

/**
 * Top-level app shell. Session state lives here in plain React state and nowhere else — the Rust
 * side keeps the session in memory only (no persistence across app restart), so the frontend
 * mirrors that instead of persisting it itself (e.g. in localStorage).
 *
 * Navigation is still plain `activeTab` state (no react-router) — a fixed set of app sections in
 * a desktop app doesn't need URL-based routing.
 */
function App() {
  const { t } = useI18n();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [autoCreateRawMaterial, setAutoCreateRawMaterial] = useState(false);
  const [autoCreateRecipe, setAutoCreateRecipe] = useState(false);

  useEffect(() => {
    // Covers hot-reload during development, where the Rust process (and its in-memory session)
    // may already have an active session even though this component just mounted.
    authApi
      .currentSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setCheckingSession(false));
  }, []);

  function goToAddRawMaterial() {
    setAutoCreateRawMaterial(true);
    setActiveTab("raw-materials");
  }

  function goToAddRecipe() {
    setAutoCreateRecipe(true);
    setActiveTab("recipes");
  }

  async function handleLogout() {
    await authApi.logout();
    setSession(null);
    setActiveTab("dashboard");
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 text-center">
        <h1 className="font-heading text-xl font-semibold">{t("app.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      </main>
    );
  }

  if (!session) {
    return <AuthScreen onAuthenticated={setSession} />;
  }

  const canManageUsers = session.user.role === "owner" || session.user.role === "admin";
  const activeItem =
    NAV_ITEMS.find((item) => item.tab === activeTab) ??
    (activeTab === "users" ? { labelKey: "nav.users" as TranslationKey } : undefined);

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <div className="flex items-center gap-2 px-2 py-1">
            <ChefHat className="size-5 shrink-0 text-primary" />
            <span className="truncate font-heading text-sm font-semibold group-data-[collapsible=icon]:hidden">
              {t("app.title")}
            </span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV_ITEMS.map((item) => (
                  <SidebarMenuItem key={item.tab}>
                    <SidebarMenuButton
                      isActive={activeTab === item.tab}
                      tooltip={t(item.labelKey)}
                      onClick={() => setActiveTab(item.tab)}
                    >
                      <item.icon />
                      <span>{t(item.labelKey)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}

                {canManageUsers && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      isActive={activeTab === "users"}
                      tooltip={t("nav.users")}
                      onClick={() => setActiveTab("users")}
                    >
                      <UsersIcon />
                      <span>{t("nav.users")}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarSeparator />

        <SidebarFooter>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <Avatar className="size-7 shrink-0">
              <AvatarFallback className="text-xs">{initials(session.user.username)}</AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
              <span className="truncate text-sm font-medium">{session.user.username}</span>
              <span className="truncate text-xs capitalize text-muted-foreground">
                {t(USER_ROLE_LABEL_KEYS[session.user.role])}
              </span>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2 group-data-[collapsible=icon]:justify-center"
            onClick={handleLogout}
          >
            <LogOut />
            <span className="group-data-[collapsible=icon]:hidden">{t("common.logout")}</span>
          </Button>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <h1 className="font-heading text-sm font-semibold">
            {activeItem ? t(activeItem.labelKey) : ""}
          </h1>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {activeTab === "dashboard" && (
            <DashboardScreen onAddRawMaterial={goToAddRawMaterial} onAddRecipe={goToAddRecipe} />
          )}
          {activeTab === "raw-materials" && (
            <RawMaterialsScreen
              autoOpenCreate={autoCreateRawMaterial}
              onAutoOpenCreateHandled={() => setAutoCreateRawMaterial(false)}
            />
          )}
          {activeTab === "suppliers" && <SuppliersScreen />}
          {activeTab === "recipes" && (
            <RecipesScreen
              autoOpenCreate={autoCreateRecipe}
              onAutoOpenCreateHandled={() => setAutoCreateRecipe(false)}
            />
          )}
          {activeTab === "categories" && <CategoriesScreen />}
          {activeTab === "cost-calculator" && <CostCalculatorScreen />}
          {activeTab === "backup" && <BackupScreen />}
          {activeTab === "settings" && <SettingsScreen />}
          {activeTab === "profile" && <ProfileScreen session={session} />}
          {activeTab === "users" && canManageUsers && <UsersSection />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

export default App;
