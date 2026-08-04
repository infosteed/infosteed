// SPDX-License-Identifier: AGPL-3.0-only

export type TextDirection = "ltr" | "rtl";
export type MessageValue = string | number;
export type MessageValues = Readonly<Record<string, MessageValue>>;

export interface TranslationCatalog {
  locale: string;
  name: string;
  direction?: TextDirection;
  messages: Readonly<Record<string, string>>;
}

export interface I18n {
  readonly locale: string;
  readonly direction: TextDirection;
  readonly catalogs: readonly TranslationCatalog[];
  t(message: string, values?: MessageValues): string;
  plural(
    singular: string,
    plural: string,
    count: number,
    values?: MessageValues,
  ): string;
  setLocale(locale: string): void;
}

export interface CreateI18nOptions {
  catalogs: readonly TranslationCatalog[];
  storageKey: string;
  preferredLocales?: readonly string[];
  storedLocale?: string | null;
  persistLocale?: (locale: string) => void;
}

function normalized(locale: string): string {
  return locale.trim().replaceAll("_", "-").toLowerCase();
}

function findCatalog(
  catalogs: readonly TranslationCatalog[],
  requested: string,
): TranslationCatalog | undefined {
  const wanted = normalized(requested);
  return (
    catalogs.find((catalog) => normalized(catalog.locale) === wanted) ??
    catalogs.find(
      (catalog) =>
        normalized(catalog.locale).split("-")[0] === wanted.split("-")[0],
    )
  );
}

function interpolate(message: string, values: MessageValues): string {
  return message.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : match,
  );
}

function browserLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  return (
    navigator.languages?.length ? navigator.languages : [navigator.language]
  ).filter(
    (locale): locale is string => typeof locale === "string" && !!locale,
  );
}

function browserStoredLocale(key: string): string | null {
  try {
    return typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function browserPersistLocale(key: string, locale: string): void {
  try {
    localStorage.setItem(key, locale);
  } catch {
    // Language persistence is optional in privacy-restricted browser contexts.
  }
}

export function createI18n(options: CreateI18nOptions): I18n {
  if (options.catalogs.length === 0)
    throw new Error("At least one translation catalog is required");

  const catalogs = [...options.catalogs].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const fallback = findCatalog(catalogs, "en") ?? catalogs[0];
  const stored =
    options.storedLocale ?? browserStoredLocale(options.storageKey);
  const preferences = [
    ...(stored ? [stored] : []),
    ...(options.preferredLocales ?? browserLocales()),
  ];
  let active =
    preferences.map((locale) => findCatalog(catalogs, locale)).find(Boolean) ??
    fallback;

  function translate(message: string, values: MessageValues = {}): string {
    const translated =
      active.messages[message] ?? fallback.messages[message] ?? message;
    return interpolate(translated, values);
  }

  const api: I18n = {
    get locale() {
      return active.locale;
    },
    get direction() {
      return active.direction ?? "ltr";
    },
    catalogs,
    t: translate,
    plural(singular, plural, count, values = {}) {
      const form = new Intl.PluralRules(active.locale).select(count);
      const keyed = active.messages[`${singular}.${form}`];
      const source = keyed ?? (form === "one" ? singular : plural);
      return translate(source, { ...values, count });
    },
    setLocale(locale) {
      const next = findCatalog(catalogs, locale);
      if (!next) return;
      active = next;
      if (options.persistLocale) options.persistLocale(next.locale);
      else browserPersistLocale(options.storageKey, next.locale);
    },
  };
  return api;
}

export function applyDocumentLocale(i18n: I18n): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = i18n.locale;
  document.documentElement.dir = i18n.direction;
}
