# Markdown fields

Every Markdown field declares which optional syntax it accepts. The same set drives the
editor's toolbar and hotkeys, its preview, and the renderer wherever the text is shown, so a
field never displays something its editor couldn't produce.

## Feature sets

`MarkdownFeatures` (`@bogey/utils/markdown`) has `headings`, `links`, `lists`, `code` and
`images`. Bold, italic, underline (`++text++`) and spoilers (`||text||`) always work. Pass a
preset name or a partial set (merged over `full`) as `features` to `MarkdownEditor`,
`field.MarkdownField`, `field.BodyField` and `Markdown`.

| Preset    | Headings | Links | Lists | Code | Images |
| --------- | -------- | ----- | ----- | ---- | ------ |
| `full`    | yes      | yes   | yes   | yes  | yes    |
| `message` | no       | yes   | yes   | yes  | yes    |
| `short`   | no       | yes   | yes   | no   | no     |
| `plain`   | no       | no    | no    | no   | no     |
| `email`   | yes      | yes   | yes   | yes  | no     |

Rejected syntax renders as the text that was typed: `## Hi` stays `## Hi`, a link keeps its
brackets and address, a list item keeps its `- `. Stored text is never rewritten, so widening a
field's set later shows the old text formatted.

## Where each set is used

| Field                                               | Set       |
| --------------------------------------------------- | --------- |
| Announcement body (composer and feed)               | `full`    |
| Chat message box, conversation thread body, bubbles | `message` |
| Event about, pages, session page, home text blocks  | `full`    |
| Session description, form description               | `short`   |
| Prize description, award note, home callout blocks  | `short`   |
| Prize value                                         | `plain`   |
| Email template bodies (also the server renderer)    | `email`   |

Anything not listed uses `full`.

## Toolbar

Bold, italic, underline, link, spoiler; a separator and H1/H2 when headings are accepted; a
separator and the field's own `items` (`MarkdownToolbarItem`: `id`, `label`, `icon`, `run`).
`run` may return Markdown to insert at the caret. The announcement dialog's attach button is
one of these.
