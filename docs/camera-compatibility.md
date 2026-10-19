# Camera compatibility milestone

## Agreed scope

Users can connect camera sources without Frigate or a pre-existing go2rtc server.
Perilune owns authenticated browser delivery and configuration; a packaged media
companion handles ingestion, remuxing and bounded on-demand conversion. Existing
NVR/go2rtc streams can be entered through the same network-source setup.

| Source                         | Intended setup                                                               | Verification status                         |
| ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------- |
| Moonraker webcam configuration | Import settings; resolve relative paths using an explicit printer web origin | Implemented; synthetic tests                |
| ustreamer / mjpg-streamer      | HTTP MJPEG and JPEG snapshots                                                | Synthetic HTTP MJPEG conversion verified    |
| camera-streamer                | Prefer available encoded HTTP or optional RTSP output                        | Encoded HTTP remux probe verified           |
| IP camera H.264                | RTSP ingestion and remux                                                     | Synthetic RTSP H.264 verified               |
| IP camera H.265                | Convert to browser-compatible H.264                                          | Synthetic RTSP HEVC conversion verified     |
| USB on Perilune host           | Optional single-device mapping and detected V4L2 profiles                    | Device acceptance pending                   |
| USB/CSI on remote printer      | Reuse capture daemon on that host                                            | Setup documented; device acceptance pending |
| JPEG-only endpoint             | Clearly identified still-image fallback                                      | Implemented; synthetic tests                |
| External go2rtc / Frigate      | Network source through the same managed setup                                | Previously shipped H.264 path               |

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
- Encoded HTTP H.264 ingestion through a copy/remux adapter.
- RTSP H.265 ingestion and H.264 output.
- Two viewers share one output producer and conversion process.
- Closing one viewer retains processing for the remaining viewer.
- Closing the last viewer stops both the synthetic producer and converter.

The container CI job repeats the probe on its host architecture. This establishes
media-engine behavior, not finished application integration or low-power-device
performance. Startup/idle bounds in the probe are test deadlines, not product
service guarantees.

## Application integration and remaining acceptance

The optional Compose companion, private persisted settings, restart reconciliation,
owner test/preview/save, discovered-source adapters, device-local quality choice,
compatible fallback and JPEG-only manual refresh are implemented. See
[camera setup](camera-setup.md) for installation and capture-host arrangements.

The real-media production smoke verifies HTTP MJPEG conversion without an NVR,
preview/save, edits during a pending save, decoded H.264, useful resolutions,
quality persistence, app and companion restart, idle shutdown, JPEG refresh,
mobile overflow and owner/CSRF guards. Unit/browser suites cover malformed inputs,
bounded tests/probes, stale revisions, preview ownership, session cancellation,
disconnect without source restoration and native-HLS selection behavior.

Actual Safari/native HLS, phones, low-power performance and representative USB/CSI
hardware require coordinated device acceptance. Synthetic fixtures establish
protocol behavior, not a universal camera compatibility or performance guarantee.
USB driver provisioning and vendor cloud integrations are not implemented.

## Primary references

- [Moonraker webcam configuration](https://moonraker.readthedocs.io/en/latest/external_api/webcams/)
- [Crowsnest](https://github.com/mainsail-crew/crowsnest)
- [ustreamer](https://github.com/pikvm/ustreamer)
- [camera-streamer outputs](https://github.com/ayufan/camera-streamer/blob/main/docs/streaming.md)
- [go2rtc FFmpeg integration](https://github.com/AlexxIT/go2rtc/blob/v1.9.14/internal/ffmpeg/README.md)
- [go2rtc producer lifecycle](https://github.com/AlexxIT/go2rtc/blob/v1.9.14/internal/streams/stream.go)
- [go2rtc V4L2](https://github.com/AlexxIT/go2rtc/blob/v1.9.14/internal/v4l2/README.md)
- [MediaMTX](https://github.com/bluenviron/mediamtx)
