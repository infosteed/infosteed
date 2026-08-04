// SPDX-License-Identifier: AGPL-3.0-only
import productLogoUrl from "../../../../packages/shared/assets/infosteed-horse-logo.svg?url";

export { productLogoUrl };

export function BrandMark({
  alt = "",
  className,
  src = productLogoUrl,
}: {
  alt?: string;
  className?: string;
  src?: string;
}) {
  return (
    <img
      className={["brand-mark", className].filter(Boolean).join(" ")}
      src={src}
      alt={alt}
    />
  );
}
