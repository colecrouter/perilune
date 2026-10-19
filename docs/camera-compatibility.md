# Camera compatibility milestone

## Agreed scope

Users can connect camera sources without Frigate or a pre-existing go2rtc server.
Perilune owns authenticated browser delivery and configuration; a packaged media
companion handles ingestion, remuxing and bounded on-demand conversion. Existing
external go2rtc installations remain supported.

| Source                         | Intended setup                                                               | Verification status                                            |
| ------------------------------ | ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Moonraker webcam configuration | Import settings; resolve relative paths using an explicit printer web origin | Integration pending                                            |
| ustreamer / mjpg-streamer      | HTTP MJPEG and JPEG snapshots                                                | Synthetic HTTP MJPEG conversion verified                       |
| camera-streamer                | Prefer available encoded HTTP or optional RTSP output                        | Adapter pending                                                |
| IP camera H.264                | RTSP ingestion and remux                                                     | Synthetic encoded stream verified; direct RTSP fixture pending |
| IP camera H.265                | Convert to browser-compatible H.264                                          | Synthetic RTSP HEVC conversion verified                        |
| USB on Perilune host           | Optional Linux V4L2 device access and format selection                       | Device acceptance pending                                      |
| USB/CSI on remote printer      | Reuse capture daemon on that host                                            | Setup documentation and device acceptance pending              |
| JPEG-only endpoint             | Clearly identified still-image fallback                                      | Integration pending                                            |
| External go2rtc / Frigate      | Existing authenticated proxy integration                                     | Previously shipped H.264 path                                  |

This is a source/protocol matrix, not a numeric camera-market coverage claim.
Proprietary cloud-only cameras and vendor-specific integrations are outside the
initial target. Multiple configured candidates may be imported, but displaying
multiple cameras simultaneously is separate scope.

## Architecture and setup

The recommended companion is go2rtc with FFmpeg. Direct FFmpeg ingestion would
require us to build additional fan-out and packaging infrastructure; MediaMTX is
also a capable router but needs additional MJPEG/conversion integration.

The normal flow is select/import a camera or add an endpoint, test connection,
preview, then save. Endpoints and credentials stay server-side. Browser requests
select opaque configured identifiers, never arbitrary URLs or FFmpeg arguments.
Owners configure sources; ordinary viewers consume the authenticated output.

Camera settings and desired profiles belong to process-scoped Effect services.
They must reconcile after companion restart, serialize configuration changes,
abort old-generation media work and preserve the existing session-revocation
leases. A failed draft connection test must not replace the saved camera.

The media control API stays private. Managed deployments must bound concurrent
profiles, memory, encoder resources and retry rates, and stop unused processing.
An external relay is not modified as though it were a Perilune-owned companion.

Reuse capture services instead of opening a USB camera already owned by another
process. A central server cannot open `/dev/video*` on a remote printer. Relative
Moonraker webcam URLs need the printer web origin, which may differ from the
Moonraker API origin and port. CSI/libcamera installation is platform-specific.

Prefer existing encoded streams. Converting an MJPEG source can reduce delivery
bandwidth but cannot improve the source frame rate, and has a CPU cost. Quality
options must describe actual available output and avoid implying automatic
bandwidth adaptation. Hardware encoding remains capability-dependent.

## Isolated prototype

Run `node scripts/probe-camera-companion.mjs` with Docker available. It uses a
pinned go2rtc image, only generated test patterns, a temporary read-only config,
a random localhost-only API port, a 384 MiB memory limit and a two-CPU limit.
It removes its container and temporary configuration afterward. It does not
contact a printer or use private camera media.

Verified locally on Linux ARM64:

- HTTP MJPEG ingestion and H.264 output.
- RTSP MJPEG ingestion and resized H.264 output.
- Native H.264 output without an additional conversion process.
- RTSP H.265 ingestion and H.264 output.
- Two viewers share one output producer and conversion process.
- Closing one viewer retains processing for the remaining viewer.
- Closing the last viewer stops both the synthetic producer and converter.

The container CI job repeats the probe on its host architecture. This establishes
media-engine behavior, not finished application integration or low-power-device
performance. Startup/idle bounds in the probe are test deadlines, not product
service guarantees.

## Remaining implementation and acceptance

1. Managed companion packaging and restart reconciliation; private persisted
   camera settings and validated source adapters.
2. Owner setup/test/preview/save flow and discovered-source selection.
3. Quality selection, remembered per device, actual output details, compatible
   fallback and errors; independent snapshots and current orientation controls.
4. HTTP snapshot, malformed source, timeout, source change, restart, simultaneous
   quality, session revocation and resource-exhaustion tests.
5. Browser and physical acceptance: desktop decode, actual Safari/native HLS,
   phone behavior, x86/ARM deployment, and representative USB/CSI devices.
6. Independent review before merging lifecycle/configuration implementation.

## Primary references

- [Moonraker webcam configuration](https://moonraker.readthedocs.io/en/latest/external_api/webcams/)
- [Crowsnest](https://github.com/mainsail-crew/crowsnest)
- [ustreamer](https://github.com/pikvm/ustreamer)
- [camera-streamer outputs](https://github.com/ayufan/camera-streamer/blob/main/docs/streaming.md)
- [go2rtc FFmpeg integration](https://github.com/AlexxIT/go2rtc/blob/v1.9.14/internal/ffmpeg/README.md)
- [go2rtc producer lifecycle](https://github.com/AlexxIT/go2rtc/blob/v1.9.14/internal/streams/stream.go)
- [go2rtc V4L2](https://github.com/AlexxIT/go2rtc/blob/v1.9.14/internal/v4l2/README.md)
- [MediaMTX](https://github.com/bluenviron/mediamtx)
