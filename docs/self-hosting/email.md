# Email

Bogey sends its own sign-in emails, so each organization gets its own sender
name and wording. Supabase Auth (GoTrue) still makes the codes and links; its
**Send Email hook** hands each email to Bogey instead of sending it itself.

> Here from the CLI? Read #2!

## 1. Give the web app SMTP credentials

In the web app's environment (server-only, never `PUBLIC_`-prefixed):

| Variable                 | Meaning                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `SMTP_HOST`              | Your mail server, e.g. `smtp.gmail.com`                    |
| `SMTP_PORT`              | `587` (STARTTLS) or `465` (TLS). Default `587`             |
| `SMTP_USER`, `SMTP_PASS` | Login, if the server needs one. For Gmail, an app password |
| `SMTP_FROM`              | The address emails come from, e.g. `noreply@example.com`   |
| `SEND_EMAIL_HOOK_SECRET` | The hook secret from step 2, `v1,whsec_...`                |

## 2. Point GoTrue at the hook

Generate a secret (any 32+ random bytes, base64) and give the same value to
both sides. For a self-hosted stack, in `/opt/supabase/.env` or your compose
file:

```sh
GOTRUE_HOOK_SEND_EMAIL_ENABLED=true
GOTRUE_HOOK_SEND_EMAIL_URI=https://your-bogey-host/api/auth/send-email
GOTRUE_HOOK_SEND_EMAIL_SECRETS=v1,whsec_<base64 secret>
```

On Supabase Cloud, set the same thing under Authentication → Hooks → Send
Email. Restart the auth container after changing its environment.

GoTrue signs every request; Bogey rejects anything unsigned, signed with a
different secret, or more than five minutes old.

## 3. Customize the emails

The sender name, wording and layout are settings:

- **Instance → Settings → Email** for the defaults, and for the layout.
- **Organization → Settings → Email** to override the sender name and wording
  for one org.

Each kind of email has a subject and a Markdown message:

| Kind                 | Sent when                               | Supabase types          |
| -------------------- | --------------------------------------- | ----------------------- |
| Sign-in              | someone signs in                        | `magiclink`, `recovery` |
| Account confirmation | someone creates an account              | `signup`                |
| Invitation           | someone is invited to create an account | `invite`                |
| Email change         | a new address needs confirming          | `email_change`          |
| Confirm it's you     | before a sensitive change               | `reauthentication`      |

In the message, `{{code}}`, `{{link}}`, `{{org}}`, `{{email}}` and `{{platform}}`
are replaced (each kind lists the ones it can use). Sign-in, confirmation,
invitation and email-change messages must include `{{code}}` or `{{link}}`. Markdown
covers headings, lists, quotes, links, **bold**, _italic_ and `code`. Two
conventions make the message look right: a Markdown link in bold, alone in
its paragraph, becomes a button (the defaults use `{{link}}` as its address), and code alone
in its paragraph (`` `{{code}}` ``) becomes the big code box. Raw HTML in a message is shown as text, not run.

The **layout** is the HTML every message is rendered into: the header, the card
and the footer. Only the instance sets it, and Bogey's default works in light and
dark mode. A layout uses `{{content}}` (required), `{{brand}}`, `{{footer}}`,
`{{subject}}`, `{{org}}`, `{{platform}}` and `{{accent}}`. Bogey always adds a
footer saying who sent the email and on whose behalf, even if the layout leaves
it out, so a message can't hide where it came from.

Each kind shows a live preview of the real email and has a "Send me the saved
version" button, which mails the saved wording to your own address. Blank fields
fall back to the next scope up, then to Bogey's defaults. Orgs can't change the
layout, and an org's stored layout is ignored.

Edits apply to the next email sent. Nothing needs a restart, because the hook
reads the settings every time. Only GoTrue's own environment (the hook URL and
secret, SMTP) needs the auth container restarted. Instance → Settings → Email says when
the hook last handled an email, or that none has, which is what to check when
edits don't seem to apply.

An org's emails are limited per day (`emailsPerDay` in Instance → Settings →
Limits, or overridden for one org), and a suspended org sends none.

## Which template is used

The organization comes from the `org` in the account's sign-up metadata, so a
person who signs in through `acme.example.com` gets Acme's email. Someone whose
account has a language gets that language's version when there is one (see
[Translating Bogey](../guides/translating.md#email-in-other-languages)).

## Links and codes

Every sign-in email has both a six-digit code and a link. The link opens
`/auth/confirm?token_hash=...` in Bogey, which checks it on the server, so it
works on any device. The code is for when the email is open somewhere else:
people enter it on the page they signed in from. `bogey login <email>` prints
both without sending anything.

## Bogey's other email: the outbox

Sign-in mail goes through the hook above. Everything else Bogey tells people by email
(registration received, approved or declined, invitations, judging assignments, deadline
reminders, results, announcements that an organizer chose to email) is written to a queue in the
database, the **outbox**, and sent from there with the same SMTP settings and the same
per-organization daily limit.

Every minute, if mail is waiting, the database calls the app at `<appUrl>/api/email/drain`
(`pg_cron` and `pg_net`), signed with a secret it keeps in Vault; the app reads the same secret
from the database, so there is nothing to configure except the address:

1. Set `appUrl` in [`bogey.config.ts`](../configuration.md#keys-only-the-file-sets) to the URL the
   database can use to reach Bogey, such as `https://hacks.example.com`, and restart the server (or
   run `bogey config apply`). On a local Supabase stack, the database runs in Docker, so use
   `http://host.docker.internal:3000`. Admins can't change it in the app, because a session that
   could would decide where the database sends requests.
2. Check **Instance → Overview**: the **Email outbox** line shows how many messages are queued, how
   old the oldest is, and the last failure.

A message that can't be sent is retried after 1, 4, 16 and 64 minutes, then marked failed. One that
would go over an organization's daily limit, or to a suspended organization, is skipped with the
reason kept. Sent and failed rows are deleted after 30 days. Mail that people can switch off carries
a one-click unsubscribe link (`List-Unsubscribe` and `List-Unsubscribe-Post`); mail about someone's
own registration doesn't.

## Without the hook

If GoTrue sends the emails itself (no send-email hook, or a local
`supabase start`), give it Bogey's templates so the emails still carry the
code and a link that works on any device. GoTrue's defaults have no code, and
their link only works in the browser that asked for it.

- **Local Supabase CLI:** `supabase/config.toml` already points at
  `supabase/templates/`, which `bogey email templates` (and `bogey watch`) generates from Bogey's
  default layout and wording using GoTrue's own variables.
- **Self-hosted Docker:** GoTrue reads templates from URLs, and Bogey serves
  them at `/api/auth/email-templates/<name>`:

  ```sh
  GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=https://your-bogey-host/api/auth/email-templates/magic_link
  GOTRUE_MAILER_TEMPLATES_CONFIRMATION=https://your-bogey-host/api/auth/email-templates/confirmation
  GOTRUE_MAILER_TEMPLATES_INVITE=https://your-bogey-host/api/auth/email-templates/invite
  GOTRUE_MAILER_TEMPLATES_RECOVERY=https://your-bogey-host/api/auth/email-templates/recovery
  GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE=https://your-bogey-host/api/auth/email-templates/email_change
  GOTRUE_MAILER_TEMPLATES_REAUTHENTICATION=https://your-bogey-host/api/auth/email-templates/reauthentication
  ```

  Restart the auth container after changing these. Any URL GoTrue can reach
  works, so you can also serve the files from `supabase/templates/` yourself.

- **Supabase Cloud:** paste the files' contents into Authentication → Email
  Templates.

These emails use one wording for every org; the hook is what makes them
per-org.
