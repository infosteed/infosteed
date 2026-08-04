// SPDX-License-Identifier: AGPL-3.0-only
import productLogoUrl from "../../../packages/shared/assets/infosteed-horse-logo.svg?url";

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      className={["product-mark", className].filter(Boolean).join(" ")}
      src={productLogoUrl}
      alt=""
    />
  );
}
