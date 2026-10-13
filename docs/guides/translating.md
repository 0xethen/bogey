# Translating Bogey

Bogey shows English until a plugin brings another language. This page is for people adding one, and for developers moving
text onto the message system.

## Use a language

Install the first-party Languages plugin (`bogey plugins add i18n`, then rebuild). Under Account → Preferences,
**Language** lists what is installed. Without a choice, Bogey follows the browser's language.

## Add a language

See the plugin's README (`plugins/i18n`): copy `es.json`, translate the values, add the language to the manifest and
runtime, and add it to the test. Keep every `{slot}` as it is. Plural messages list the forms your language needs:

```
"nav.notificationsUnread": "Notificaciones, {count, plural, one {# sin leer} other {# sin leer}}"
```

A message you haven't translated shows in English, so you can ship a language before it is finished. Under Manage → Plugins the
plugin's **When a message isn't translated** setting can show another language instead, or the message's key, which is handy for
finding what is left. A key that exists nowhere (a typo) shows as itself; it never breaks the page.

## Email in other languages

Email goes out in the language of the person's account (Account → Preferences → Language), when they chose one. A new account
hasn't, so its sign-up email is in the default wording.

- A language plugin translates Bogey's default wording too: keys `emailTemplate.<kind>.subject`, `.body` and `.reason` (the
  footer's "because ..."), and the footer sentences `emailFooter.*`. Keep every `{{variable}}`; the plugin's tests check them.
- Organizers write a language's own version in Email settings: pick the language at the top, then fill in any kind. It's saved
  under `<kind>@<code>` (like `registration.approved@es`) and inherits instance → org → event like the default wording.
- For someone with a language, an email uses that language's version if one was written, else the organizer's default wording
  (their own words beat a generic translation), else the plugin's translation, else Bogey's English.

## Move text onto messages (developers)

1. Add a key to `packages/config/src/messages.ts`, named `area.thing`, with the English text and `{slots}` for anything that varies.
   Inside a plural, every choice needs a `#`.
2. In the component, `const t = useT();` and write `t("area.thing", { name })`. A sentence with a link in the middle is split
   at the link, one message each side, with the link text its own message.
3. Text outside a component (a form schema's labels, a route's `staticData.title`) can't call a hook yet; leave it, and note
   it. Turn the schema into a function of `t` first.
4. `vp check` fails if a key doesn't exist or its slots don't match. Run the Languages plugin's tests to see what a
   translation is missing.

Dates and numbers: pass the locale from `useLocale()` (the viewer's time format does this already) and use `Intl`, never
hand-built formats.
