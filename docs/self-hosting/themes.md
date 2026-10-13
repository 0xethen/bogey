# Themes

A theme is a CSS file in `packages/ui/src/styles/themes/<key>.theme.css` that
sets Bogey's design tokens (colors, fonts, `--radius`, `--spacing`).

- `default.theme.css` styles `:root` and is Bogey's own look.
- Every other theme styles `:root[data-theme="<key>"]` and only needs the
  tokens it changes.
- A `/* @theme Label */` line names it in menus.

Set colors for light (`:root`) and dark (`.dark`) and you're done. The
menubar is a `surface-primary`: inside it, text, muted text, borders and focus
rings are derived from `--primary` and `--primary-fg`, so hovers and buttons
on the bar read correctly in any theme and mode. Pick a `--primary-fg` that
contrasts with `--primary`.

Radii all derive from `--radius`, pills included (`rounded-pill`), so a theme
with `--radius: 0` is square everywhere. Spacing derives from `--spacing`.

## Choosing the instance's theme

Set `brand.theme` in `bogey.config.ts`. The app puts it on
`<html data-theme>` during SSR, so there's no flash and nothing to load.

## Adding a theme

1. Add `packages/ui/src/styles/themes/<key>.theme.css`.
2. `pnpm dev` runs `bogey watch`, which regenerates `styles/themes.css` (the
   imports) and `@bogey/config/themes` (the `ThemeKey` type and list). Outside
   dev, run `bogey themes`.

## Letting people pick

Core applies one theme. The theme-switcher plugin
(`packages/plugins/examples/theme-switcher`; copy it to
`packages/plugins/installed/theme-switcher`) adds a Theme submenu to the account
menu when more than one theme is installed. The choice is kept per browser and
applied before the page paints.
