# Camera source workflow review

Independent reviewer: `review_camera_source_workflow`. Result: approved after two
actionable findings were resolved:

- Local discovery now has one process-scoped slot, rejects concurrent scans and
  releases the slot after cancellation. Regression coverage checks busy/retry.
- Accepted V4L2 capture formats match the pinned go2rtc producer: MJPEG, H.264,
  HEVC, YUYV and NV12. Unsupported profiles are omitted instead of offered and
  subsequently failing. Input/profile tests cover unsupported formats.

The reviewer inspected SSR-awaited remote configuration, owner checks before and
after reads, private source summaries, cancellation, re-enumeration before local
tests, bounded parsing and explicit single-device Compose mapping. No remaining
blocking findings. No physical capture claims were made.

Production media smoke verifies server-rendered settings and the absence of a
mount-time configuration REST request, USB empty state, existing test/preview/save,
actual H.264 decode, draft preservation, restarts and manual JPEG refresh. Source
controls wait for their handler before becoming interactive, avoiding lost
pre-hydration changes now that configuration renders on the server.

Native collaborative browser checks covered desktop and 390-pixel layout, local
source selection, scanning without a device, no overflow and clean console.
Physical USB capture/unplug, custom capture dimensions/rates, real Safari and Pi
CSI capture drivers remain separate acceptance/future work.

Query refresh failures retain the last successful snapshot and local drafts. A
successful save remains acknowledged when its follow-up read fails, with an
explicit retry control; the media smoke forces that read to fail and then retries.
