# Keyboard shortcuts

Press **Shift /** (`?`) on any page to see the shortcuts it has right now. Each
person can change or turn off the app-wide ones on **Account → Keyboard
shortcuts**; the choice follows them to every device.

| Shortcut     | Default | What it does                                      |
| ------------ | ------- | ------------------------------------------------- |
| Command menu | Mod+K   | Find any page, event or action                    |
| Shortcuts    | Mod+/   | Lists the shortcuts the page has                  |
| Save changes | Mod+S   | Saves what the save bar is holding, from anywhere |

Mod is ⌘ on a Mac and Ctrl elsewhere. Markdown fields add Mod+B (bold), Mod+I
(italic), Mod+U (underline), Mod+\ (spoiler) and, where the field accepts them,
Mod+K (link) and Mod+Alt+1 / Mod+Alt+2 (heading 1 / 2) while you're typing in them.
See [Markdown fields](../architecture/markdown.md).

## Adding one

Add it to `SHORTCUTS` in `apps/web/src/lib/shortcuts.ts` with a name,
description, group and default keys, then register it where it applies:

```ts
useShortcut("save", () => save(), { enabled: dirty });
```

`useShortcut` uses the person's own keys and adds the shortcut to the help
list. For one tied to a single element, use TanStack Hotkeys' `useHotkey` with
`target` and `meta` so it still shows in the help while it's mounted.
