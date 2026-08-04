// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import type { BrandingSettings, CurrentUser } from "@infosteed/shared";
import { BrandMark } from "./components/BrandMark";
import { getBranding, logout, logoutAll, me, setupStatus } from "./api";
import "./styles.css";
import { t } from "./i18n";
import { AuthForm } from "./components/AuthForm";
import { LegalView } from "./components/LegalView";
import { GuideBrowser } from "./components/GuideBrowser";
import { AdminPanel } from "./components/AdminPanel";
import { useRecordingController } from "./features/recording/useRecordingController";
import { currentRecordingId, currentView } from "./navigation";
import { RecordingScreen } from "./screens/RecordingScreen";

export function App() {
  const recordingId = currentRecordingId();
  const requestedView = currentView();
  const [setupRequired, setSetupRequired] = useState<boolean | undefined>();
  const [user, setUser] = useState<CurrentUser | undefined>();
  const [branding, setBranding] = useState<BrandingSettings>({
    displayName: "InfoSteed",
    iconDataUrl: null,
  });
  const [authChecked, setAuthChecked] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const recordingController = useRecordingController(recordingId, user);

  async function refreshAuth() {
    const status = await setupStatus();
    setSetupRequired(status.required);
    if (status.required) {
      setAuthChecked(true);
      return;
    }
    try {
      const result = await me();
      setUser(result.user);
      setBranding(await getBranding());
    } catch {
      setUser(undefined);
    } finally {
      setAuthChecked(true);
    }
  }

  useEffect(() => {
    void refreshAuth();
  }, []);

  if (requestedView === "legal") return <LegalView />;

  if (!authChecked)
    return (
      <main className="empty product-loading">
        <BrandMark />
        <p>{t("Loading InfoSteed...")}</p>
      </main>
    );
  if (setupRequired) {
    return (
      <AuthForm
        mode="setup"
        onDone={(nextUser) => {
          setUser(nextUser);
          setSetupRequired(false);
          void getBranding().then(setBranding);
        }}
      />
    );
  }
  if (!user) {
    return (
      <AuthForm
        mode="login"
        onDone={(nextUser) => {
          setUser(nextUser);
          setSetupRequired(false);
          void getBranding().then(setBranding);
        }}
      />
    );
  }
  if (adminOpen) {
    return (
      <AdminPanel
        onClose={() => {
          setAdminOpen(false);
          void getBranding().then(setBranding);
        }}
      />
    );
  }
  if (!recordingId) {
    return (
      <GuideBrowser
        user={user}
        branding={branding}
        onOpenAdmin={() => setAdminOpen(true)}
        onLogout={() => void logout().then(() => setUser(undefined))}
        onLogoutAll={() => {
          if (window.confirm(t("Log out every session for this account?")))
            void logoutAll().then(() => setUser(undefined));
        }}
      />
    );
  }
  return (
    <RecordingScreen
      user={user}
      branding={branding}
      requestedView={requestedView}
      recordingController={recordingController}
      onOpenAdmin={() => setAdminOpen(true)}
      onLogout={() => void logout().then(() => setUser(undefined))}
      onLogoutAll={() => {
        if (window.confirm(t("Log out every session for this account?")))
          void logoutAll().then(() => setUser(undefined));
      }}
    />
  );
}
