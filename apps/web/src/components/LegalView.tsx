// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useState } from "react";
import { systemInfo } from "../api";
import { errorMessage } from "../errors";
import { BrandMark } from "./BrandMark";

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
      <p>About and legal</p>
      <div className="legal-brand">
        <BrandMark />
        <h1>{info?.productName ?? "InfoSteed"}</h1>
      </div>
      {error && <p className="error">{error}</p>}
      <dl>
        <dt>Version</dt>
        <dd>{info?.releaseVersion ?? "Loading..."}</dd>
        <dt>Commit</dt>
        <dd>{info?.releaseCommit ?? "Loading..."}</dd>
        <dt>Protocol</dt>
        <dd>{info?.protocolVersion ?? "Loading..."}</dd>
      </dl>
      <h2>GNU Affero General Public License</h2>
      <p>
        This program is free software under AGPL-3.0-only. It is provided
        without any warranty, to the extent permitted by law.
      </p>
      {info?.exactSourceUrl ? (
        <p>
          <a href={info.exactSourceUrl}>
            Corresponding source for this exact version
          </a>
        </p>
      ) : (
        <p>The administrator has not configured the public source URL.</p>
      )}
      <p>
        <a href="/LICENSE">Read the full AGPL text</a>
      </p>
      <h2>Commercial licensing</h2>
      <p>Separate commercial terms are not currently available.</p>
      <p>
        <a href="/">Return to the application</a>
      </p>
    </main>
  );
}
