# 0024: Languages come from a small catalog seam and plugins

**Status:** accepted (2026-10-10). Builds on [0013](0013-email-templates.md).

## Context

Events run in more than one language. Bogey's text was English only, written straight into components. A translation
system had to work with server rendering, must not put the language in every URL (links are shared and printed), and should
let a language be added without changing Bogey's code, the way other optional things are.

## Decision

- **Messages have keys.** The app's English messages (`@bogey/config/messages`) are the source every language falls back to, and a
  small formatter and translator (`@bogey/utils/messages`) fill in `{name}` slots and `{count, plural, one {# item} other {# items}}` choices, with numbers formatted by
  `Intl`. Components call `useT()` and `t("area.thing", { name })`. The keys and their slots are types, so a missing slot or
  an unknown key doesn't compile.
- **The language is not in the URL.** It is the person's account language if they chose one, else what their browser
  asks for (`Accept-Language`), else English. The choice is remembered in a `locale` cookie so pages before sign-in, and
  server rendering, agree. Dates and numbers use the same locale through `Intl`.
- **Languages are plugins.** A plugin declares `locales` in its manifest and supplies each language's catalog in
  `catalogs` in its runtime; the first-party `i18n` plugin brings Spanish. Core never ships a translation, so a language can
  be added, fixed or dropped without a Bogey release. A language with no plugin doesn't appear in the picker.
- **What shows where a translation is missing is the plugin's choice.** Its `missing` setting picks English (the default),
  another language then English, or the key itself. A key that exists nowhere shows as itself and a message that can't be
  formatted shows as written, so a typo never breaks a page. The plugin's own tests (`checkCatalog`) fail a catalog that names
  a message English doesn't have or changes a message's slots.
- **Almost nothing of it is a package.** The language list, catalogs, missing-message policy and translation checks live in the
  plugin; core keeps only the seam: English text, the formatter and the hooks.
- **Moving text over is incremental.** Extracting every sentence from the app is done directory by directory; the progress
  is recorded where the work is tracked, and anything not moved yet stays English in every language.

## Consequences

- Strings that live at module level (form schemas, route titles) can't call a hook. They need to become functions of `t`
  before they can be translated, which is why they move last.
- Email wording still follows ADR 0013's per-event templates. Per-language email templates are not part of this change.
- Right-to-left layout is not handled; a catalog for such a language would show with left-to-right layout until it is.
