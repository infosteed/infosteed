// SPDX-License-Identifier: AGPL-3.0-only
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Toaster } from "./components/ui/sonner";
import { t } from "./i18n";
import { ThemeProvider, useTheme } from "./theme";

document.title = t("InfoSteed Editor");

function ThemedApplication() {
  const { resolvedTheme } = useTheme();
  return (
    <>
      <App />
      <Toaster theme={resolvedTheme} richColors closeButton />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <ThemedApplication />
  </ThemeProvider>,
);
