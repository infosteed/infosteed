# Translating InfoSteed

The web app and browser extension discover JSON translation catalogs at build
time. A missing message safely falls back to the English source phrase. The UI
selects the closest available language from the user's browser settings, and a
user can override it from the language selector.

## Add a language

1. Run `corepack pnpm i18n:extract` to refresh the English templates.
2. Copy `apps/web/src/locales/en.json` to a file named with the language's BCP
   47 code, such as `fr.json` or `pt-BR.json`.
3. Change `locale`, set `name` to the language's name in that language, and
   translate each value in `messages`. Do not change the English keys.
4. Repeat for `apps/extension/src/locales/en.json` if translating the extension.
5. For the extension's name and description in Chrome, copy
   `apps/extension/public/_locales/en/messages.json` into Chrome's matching
   locale directory and translate its `message` values. Chrome uses underscores
   for regional locale directory names, for example `pt_BR`.
6. Run `corepack pnpm i18n:check` and the normal tests.

Keep placeholders such as `{name}` and `{count}` unchanged. The check reports a
missing message or placeholder before a translation can be merged. Set
`direction` to `rtl` for right-to-left languages; InfoSteed then updates the
document language and direction automatically.

For a language with more than English's singular and plural forms, add a key
made from the singular phrase and the `Intl.PluralRules` category. For example,
`"{count} item.few"` supplies the `few` form. These extra keys are preserved by
the extractor.

When adding UI text in TypeScript or TSX, wrap it with `t("English text")`. Use
`t("Hello {name}", { name })` for inserted values and
`plural("{count} item", "{count} items", count)` for quantities. Running the
extract command adds these phrases to the English templates.
