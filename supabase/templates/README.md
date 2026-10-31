# Supabase email templates

SnapX signs in with an eight-digit email code. The email must never contain a
sign-in link: a link opens the callback page, while the login page asks for the
code. All three templates below are the same code-only body.

| Hosted template | Management API subject field | Management API body field | File |
|---|---|---|---|
| Confirm signup | `mailer_subjects_confirmation` | `mailer_templates_confirmation_content` | `confirm-signup.html` |
| Magic Link | `mailer_subjects_magic_link` | `mailer_templates_magic_link_content` | `magic-link.html` |
| Reauthentication | `mailer_subjects_reauthentication` | `mailer_templates_reauthentication_content` | `reauthentication.html` |

Every subject is `Your SnapX sign-in code`. Every body contains `{{ .Token }}`
and no `{{ .ConfirmationURL }}` and no `<a>` element.

## Apply with the Management API

The token is a Supabase personal access token. It is read from the environment
and must never be written to a file or printed.

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
node scripts/set-auth-templates.mjs            # read-only: print the current values
node scripts/set-auth-templates.mjs --apply    # PATCH and verify
```

The script PATCHes:

```json
{
  "mailer_subjects_confirmation": "Your SnapX sign-in code",
  "mailer_templates_confirmation_content": "<contents of confirm-signup.html>",
  "mailer_subjects_magic_link": "Your SnapX sign-in code",
  "mailer_templates_magic_link_content": "<contents of magic-link.html>",
  "mailer_subjects_reauthentication": "Your SnapX sign-in code",
  "mailer_templates_reauthentication_content": "<contents of reauthentication.html>",
  "mailer_otp_length": 8,
  "mailer_otp_exp": 600
}
```

`mailer_otp_length` must be 8 (the login form has eight boxes) and
`mailer_otp_exp` is 600 seconds (ten minutes). Record the current values before
changing them; the script prints them.

## Dashboard fallback

If the Management API cannot be used:

1. Authentication → Emails → Templates.
2. **Confirm signup**: subject `Your SnapX sign-in code`; replace the body with
   `supabase/templates/confirm-signup.html`.
3. **Magic Link**: subject `Your SnapX sign-in code`; replace the body with
   `supabase/templates/magic-link.html`.
4. **Reauthentication**: subject `Your SnapX sign-in code`; replace the body
   with `supabase/templates/reauthentication.html`.
5. Authentication → Providers → Email → Email OTP: set **Email OTP length** to
   `8` and **Email OTP expiry** to `600` seconds. Save.
6. Send a test email to a new address and a returning address. Both must show
   the eight-digit code and no link.

Until this is applied, a new email still receives the default confirmation link
and the login page cannot complete sign-in with a code.
