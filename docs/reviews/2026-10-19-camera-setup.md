# Camera setup and playback review

Independent reviewer: `review_camera_setup_final`. Result: approved without
blocking findings after reviewing the full setup/playback implementation and the
new HTTP remux, JPEG-only, lifecycle, isolation and CI paths.

Earlier review findings were resolved:

- Managed HLS uses the selected companion base rather than the legacy relay base;
  both absent and different legacy bases have regression coverage.
- Saving preserves edits made while the save request is pending; the real-media
  smoke holds that response and verifies the newer draft survives.
- Snapshot HTTP credentials are sent through a private Basic authorization header
  after removing URL userinfo, with regression coverage.
- Startup restores companion definitions asynchronously without blocking the app.
- Preview tests cover session ownership and invalidation after save/expiry.

The final reviewer checked source validation, fixed FFmpeg templates, bounded
probes and draft leases, authorization/privacy, restart reconciliation, browser
fallback, private Compose networking and real-media CI. A minor wording finding
was resolved by making snapshot preview failure copy neutral about media type.

Validation evidence is recorded in the PR. Synthetic media verifies protocol and
browser behavior; actual Safari, low-power hardware and USB/CSI acceptance remain
coordinated device checks. No physical printer commands were issued.
