// SPDX-License-Identifier: AGPL-3.0-only
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { t } from "./i18n";

document.title = t("InfoSteed Editor");

createRoot(document.getElementById("root")!).render(<App />);
