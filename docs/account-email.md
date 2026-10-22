# Optional account email

Perilune works without email. Password/passkey login, browser pairing, copyable
invitations and offline host recovery remain available. SMTP enables emailed
invitations and verified-address password recovery; it does not enable public signup.

Configure these environment variables on the server and restart Perilune:

```dotenv
PERILUNE_SMTP_HOST=smtp.example.com
PERILUNE_SMTP_PORT=465
PERILUNE_SMTP_FROM=Perilune <printer@example.com>
PERILUNE_SMTP_USER=your-smtp-user
PERILUNE_SMTP_PASSWORD=your-smtp-password
```

Port 465 uses implicit TLS. Other ports require STARTTLS by default. A trusted
local relay/test fixture can explicitly set `PERILUNE_SMTP_ALLOW_INSECURE=true`;
keep that off for internet SMTP. The Compose file forwards these variables.
Secrets belong in the private deployment environment, never the repository.
Choose the sender/domain and DNS authentication settings required by your provider.
No particular mail provider is required. SMTP configuration is server-managed;
the web UI exposes availability and redacted send status, not credentials.

In Account → Access & people, an owner can send a test email to their own account
address. “Accepted by mail server” means SMTP accepted it, not that it reached the
inbox. Check spam filtering and your provider's logs if it does not arrive.
Unknown send outcomes are never retried automatically; request another explicitly.
Queued messages expire after five minutes; links have their own expiry.

Existing accounts remain usable and are not silently marked verified. While
signed in, request verification from Account, open the emailed link and explicitly
confirm the address. Verification alone does not change your password or sessions.
After verification, Forgot password can send a single-use link lasting 30 minutes.
Repeated requests replace prior links. Reset signs out all browser sessions and
invalidates pending pairing grants/other recovery links. It preserves passkeys,
slicer keys and push registrations. Sign in normally after reset. A confirmation
email is queued when capacity permits. Ordinary reset requires an existing password;
it cannot bypass an emergency recovery already initiated by the host.

Emergency owner recovery is separate: stop the service and run the existing
`node scripts/auth.mjs recover <owner-email> --server-stopped` workflow. It revokes
credentials/integrations through the security epoch, including passkeys. Use it
when access is lost or compromise is suspected. No email configuration is required.

Emailed invitations are restricted to their recipient address and last 24 hours.
Copyable invitations remain bearer links: share them privately. Creating or sending
an invitation does not verify the email typed during enrollment. The invite list
shows ready, used, expired and revoked states; revoke unused links when appropriate.

Email work runs in a process-scoped Effect service with a bounded durable outbox.
Link payloads are encrypted with an installation-secret-derived key; standalone
recovery tokens are hashed. Claims recheck account epochs, address, token expiry
and invitation validity. SMTP dispatch is claimed before sending; a restart during
sending records an unknown outcome. Only storage checkpoints are retried. Terminal
payloads are erased and history is retained for at most seven days. Include the
existing auth secret and private SMTP environment in your private disaster-recovery
plan; do not publish queue/database dumps.

## Local capture inbox experiment

[Mailpit](https://mailpit.axllent.org/) captures SMTP messages in a web inbox
without delivering them externally. Follow its [Docker installation guide](https://mailpit.axllent.org/docs/install/docker/)
and [runtime configuration reference](https://mailpit.axllent.org/docs/configuration/runtime-options/).
For a temporary host-network Perilune installation:

```sh
docker run -d --name perilune-mailpit \
  -p 127.0.0.1:4325:8025 -p 127.0.0.1:4326:1025 \
  -e MP_MAX_MESSAGES=100 -e MP_MAX_AGE=1d axllent/mailpit
```

Set the following private server environment, forward it into the Perilune
container, and recreate the service:

```dotenv
PERILUNE_SMTP_HOST=127.0.0.1
PERILUNE_SMTP_PORT=4326
PERILUNE_SMTP_FROM=Perilune <accounts@example.test>
PERILUNE_SMTP_ALLOW_INSECURE=true
```

Leave SMTP username/password unset. This plaintext exception is only for the
loopback capture inbox. For bridge-network Compose installations, use the Mailpit
service name and container port 1025 instead; localhost inside Perilune refers to
its own container. Do not expose either Mailpit port publicly or configure a relay.

Forward the inbox to your workstation:

```sh
ssh -N -L 8025:127.0.0.1:4325 your-server
```

Open `http://localhost:8025`, then send a test from Account. Request email
verification and explicitly confirm the link in the captured message. Use a
disposable invited account to test password reset, session revocation and normal
sign-in, rather than resetting an active owner's password. Capture mode accepts
any recipient; verification here demonstrates the application flow, not ownership
of a real inbox. It does not validate public DNS authentication or inbox delivery.

Before returning to normal operation, disable SMTP or replace these settings with
a real provider, remove the plaintext exception, and recreate Perilune. Stop and
remove the capture container (`docker rm -f perilune-mailpit`) to discard its
inbox. Treat captured recovery links as credentials. Do not publish its messages.

For actual delivery, consult your provider's guides, for example
[Resend domain verification](https://resend.com/docs/dashboard/domains/introduction)
and [SMTP setup](https://resend.com/docs/send-with-smtp). Keep existing DNS mail
records intact and add only the records required for your selected sending domain.

## Reverse proxies and hydration

Perilune sends `Cache-Control: no-store, no-transform` on application HTML responses.
Keep `no-transform` intact through your reverse proxy: rewriting server-rendered
HTML can break Svelte hydration and leave visible controls unresponsive.
In particular, [Cloudflare Email Address Obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/)
replaces email text with a link; Cloudflare documents `no-transform` as preventing
that rewrite. Disable any other HTML-rewriting features that ignore this directive.

## Reset links without SMTP

Owners can open **Account → Access & people**, choose **Reset password…** beside
an operator or viewer, confirm the recipient, and create a single-use link.
A password or passkey sign-in within the last ten minutes is required;
paired-browser sign-in cannot authorize issuance. The dialog offers sign-in again
when needed. Owner accounts continue to use the host recovery procedure.

The link expires after ten minutes and appears only in the creation dialog.
Share it privately with the intended recipient. Closing the dialog hides it;
the history contains status and revocation controls, never the link itself.
Creating another link for the account revokes the previous owner-generated link.
Issuance alone does not change credentials or sign out browsers.

Redemption changes the password and signs out ordinary and paired browsers.
Passkeys, slicer keys, notification registrations and the email verification
status are preserved. Issuance, revocation, redemption and known failed attempts
are audited without storing the raw link. Account or issuer credential changes
invalidate outstanding links. Owners can revoke an unused link from its history.
