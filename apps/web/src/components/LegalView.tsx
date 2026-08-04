// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { systemInfo } from "../api";
import { errorMessage } from "../errors";
import { t } from "../i18n";
import { BrandMark } from "./BrandMark";
import { LanguageSelect } from "./LanguageSelect";

export function LegalView() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof systemInfo>>>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void systemInfo()
      .then(setInfo)
      .catch((reason) => setError(errorMessage(reason)));
  }, []);

  return (
    <main className="legal-page">
      <p>{t("About and legal")}</p>
      <div className="legal-brand">
        <BrandMark />
        <h1>{info?.productName ?? "InfoSteed"}</h1>
      </div>
      {error && <p className="error">{error}</p>}
      <dl>
        <dt>{t("Version")}</dt>
        <dd>{info?.releaseVersion ?? t("Loading...")}</dd>
        <dt>{t("Commit")}</dt>
        <dd>{info?.releaseCommit ?? t("Loading...")}</dd>
        <dt>{t("Protocol")}</dt>
        <dd>{info?.protocolVersion ?? t("Loading...")}</dd>
      </dl>
      <h2>GNU Affero General Public License</h2>
      <p>
        {t(
          "This program is free software under AGPL-3.0-only. It is provided without any warranty, to the extent permitted by law.",
        )}
      </p>
      {info?.exactSourceUrl ? (
        <p>
          <a href={info.exactSourceUrl}>
            {t("Corresponding source for this exact version")}
          </a>
        </p>
      ) : (
        <p>
          {t("The administrator has not configured the public source URL.")}
        </p>
      )}
      <p>
        <a href="/LICENSE">{t("Read the full AGPL text")}</a>
      </p>
      <h2>{t("Commercial licensing")}</h2>
      <p>{t("Separate commercial terms are not currently available.")}</p>
      <p>
        <a href="/">{t("Return to the application")}</a>
      </p>
      <LanguageSelect />
    </main>
  );
}
