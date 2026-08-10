# Source provenance

InfoSteed includes dependencies, generated templates, and locally modified third-party source. Preserve their provenance as carefully as their code.

Before importing source, templates, design tokens, or generated components:

1. Confirm that the source licence permits use, modification, AGPL distribution, and any intended commercial distribution. Do not copy code that has no licence or is merely source-available.
2. Record the upstream project, source URL, licence, pinned version or commit, import date, affected local files, and the nature of local modifications.
3. Preserve upstream copyright and licence notices. Add full required texts inside the marked manual section of `THIRD_PARTY_NOTICES.md`.
4. Mark source-derived files accurately. Do not replace an upstream notice with an InfoSteed-only copyright or SPDX identifier.
5. Prefer an ordinary package dependency when vendoring is unnecessary. Keep lockfiles and generated dependency notices current.
6. Review generated or AI-assisted code for recognisable third-party material; generation does not remove attribution or licence obligations.

`pnpm notices:generate` regenerates the dependency inventory but preserves the manually maintained vendored-source section. Run `pnpm notices:check` and `pnpm spdx:check` before release.

When provenance is uncertain, do not merge the material until its origin and licence are resolved or the implementation has been independently rewritten from documented requirements.
