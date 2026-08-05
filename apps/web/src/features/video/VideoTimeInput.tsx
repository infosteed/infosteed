// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n";
import {
  parseVideoTimestamp,
  videoTimestampLabel,
} from "../../video-editor/model";

export function VideoTimeInput({
  label,
  value,
  min = 0,
  max,
  disabled = false,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  disabled?: boolean;
  onChange(value: number): void;
}) {
  const [draft, setDraft] = useState(() => videoTimestampLabel(value));
  const [error, setError] = useState<string>();
  const skipNextBlur = useRef(false);

  useEffect(() => {
    setDraft(videoTimestampLabel(value));
    setError(undefined);
  }, [value]);

  function commit() {
    const parsed = parseVideoTimestamp(draft);
    if (parsed === null || parsed < min || parsed > max) {
      setError(
        t("Enter a time between {start} and {end}.", {
          start: videoTimestampLabel(min),
          end: videoTimestampLabel(max),
        }),
      );
      return;
    }
    setError(undefined);
    setDraft(videoTimestampLabel(parsed));
    if (parsed !== value) onChange(parsed);
  }

  return (
    <label className="video-time-input">
      <span>{label}</span>
      <input
        aria-invalid={Boolean(error)}
        disabled={disabled}
        inputMode="decimal"
        value={draft}
        onBlur={() => {
          if (skipNextBlur.current) {
            skipNextBlur.current = false;
            return;
          }
          commit();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            skipNextBlur.current = true;
            setDraft(videoTimestampLabel(value));
            setError(undefined);
            event.currentTarget.blur();
          }
        }}
      />
      {error && <small className="error">{error}</small>}
    </label>
  );
}
