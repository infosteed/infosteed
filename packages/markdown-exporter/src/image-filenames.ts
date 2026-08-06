// SPDX-License-Identifier: AGPL-3.0-only

export function basenameWithoutExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

export function exportImageFilename(
  filename: string,
  suffix?: string,
  extension?: string,
): string {
  const base = suffix
    ? `${basenameWithoutExtension(filename)}-${suffix}`
    : basenameWithoutExtension(filename);
  const sourceExtension = /\.([^.]+)$/.exec(filename)?.[1] ?? "webp";
  const output = `${base}.${extension ?? sourceExtension}`;
  if (
    output.length === 0 ||
    output.includes("/") ||
    output.includes("\\") ||
    output.includes("..")
  ) {
    throw new Error(`Invalid export image filename: ${output}`);
  }
  return output;
}
