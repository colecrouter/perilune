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
