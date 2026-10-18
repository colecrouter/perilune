# Comfortable daily use: owner review

The implementation can be checked with automated protocol and headless-browser tests.
Physical print results and phone/OS delivery need owner acceptance. No automated test
should be interpreted as a successful deposited print or actual phone notification.

## Attended small print

- Clear the bed, load the intended filament, and choose a small known-good slice.
- Inspect material, estimates, and the manual-change/pause summary. A file with
  intentional changes should list them; custom macros can introduce other pauses.
- Upload without starting, then deliberately start once. Observe the first layer.
- Check progress and temperatures against the printer. If the job requests a filament
  change, follow the configured macro’s messages; a purge-only Resume can leave it paused.
- If stopping is needed, check the independent nozzle/bed cooldown choices.
- Let a print finish and verify its physical result, completion state, and history.
- Record failures with the step, visible behavior, and versions. Keep private media,
  hostnames, credentials, and printer configuration out of public reports.

## Phone and notifications

Use the existing HTTPS panel; no new backend is needed on the phone.

- Sign in, navigate Overview/Jobs/Console/Account/Help, and check camera playback.
- Install on the Home Screen (iOS/iPadOS) or via the browser’s install menu (Android).
- Check light/dark and any OS-supported icon tinting, then standalone login.
- Enable notifications from Account and send a test. Close the app and verify delivery.
- Check quiet hours, disabling notifications, and revocation. A push-service acceptance
  message does not prove OS delivery.
- During the attended print, verify completion/failure delivery where applicable.
- If enabled, verify optional snapshots; expired/signed-out media should fall back to
  generic text. Do not upload private camera captures as public evidence.
- With a draft open, verify an update offers Later and preserves the draft until
  explicitly reloading. Check that another tab is not forcibly reloaded.

Track device/OS versions and the results in #35 and #52. Choose an off-host backup
destination before relying on the installation for daily use.
