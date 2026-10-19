# Camera setup

Perilune can connect a camera without Frigate or an existing NVR. Its optional
private companion packages go2rtc and FFmpeg; camera capture still happens where
the camera is physically connected.

## Install

From the repository, use the normal Compose configuration plus the camera override:

```sh
docker compose -f compose.yaml -f compose.camera.yaml up -d
```

Keep both files in subsequent Compose commands. The override pins the media image,
provides a read-only configuration and root filesystem, bounds temporary storage,
CPU and memory, and publishes no camera/control ports. The app reaches the service
as `http://camera:1984/` on its private Compose network. Do not expose that API
through a reverse proxy. It has administrative access to configured camera sources.

For a standalone Node deployment, run the same pinned companion privately and set
`PERILUNE_CAMERA_COMPANION_URL` to its server-reachable HTTP API base. A host-network
app needs a loopback-bound companion port rather than Compose service DNS. Ensure
both containers can reach the source; `localhost` in a container means that
container. The original external relay variables remain supported independently.

If Moonraker webcam entries use relative URLs, set `PERILUNE_PRINTER_WEB_ORIGIN`
to the printer's web origin, including its web port if needed. This may differ
from the Moonraker API address. Missing this setting leaves relative candidates
unavailable rather than guessing an address.

## Connect

As an owner, open **Camera settings** from the overview. Choose an imported
Moonraker camera or enter a source. Use **Video stream** for HTTP MJPEG, encoded
HTTP or RTSP; use **Still image** for a JPEG-only endpoint. Enter an optional JPEG
snapshot endpoint independently of video. Source credentials can be included in
the endpoint; they are stored privately in the server database. Protect database
files and backups as credentials. Saved endpoints are never returned to the form.

Test the connection, inspect the preview if available, then save. A failed test
leaves the current camera in place. Tests expire after five minutes; concurrent
settings changes require a fresh test. A missing snapshot does not invalidate
working video. Disconnect restores any legacy configured/discovered relay source.
Rotation and flips affect display, while downloaded captures retain source pixels.

The companion prefers H.264 without re-encoding. MJPEG and H.265 can be converted
on demand. Balanced (640 pixels wide) and Data saver (320 pixels wide) appear only
when they reduce the detected width. Selection is local to each browser/device.
There is no automatic bandwidth adaptation. Original means the tested compatible
output; an incompatible input may already require conversion to H.264.

JPEG-only cameras show a still image and an explicit refresh control, without
claiming live video. Media and snapshots use authenticated same-origin routes.
Snapshot failures are independent of video. Session revocation closes active
media; settings changes invalidate prior media sessions.

## Common camera arrangements

- **USB on a printer host:** reuse Crowsnest/ustreamer or camera-streamer already
  capturing the device. Import its Moonraker entry or enter its HTTP/RTSP output.
  Prefer encoded output when available. Do not open the same USB device twice.
- **USB on the Perilune host:** run a Linux capture service on that host and connect
  its HTTP/RTSP output. Alternatively use the explicit local USB mapping described below. This release
  does not install/configure capture drivers. Container capture needs an explicit
  device mapping in that capture service; do not use privileged mode by default.
- **Pi CSI:** use the capture software appropriate to the Pi's camera/OS stack,
  such as a compatible camera-streamer or Crowsnest setup. Configure its network
  output, not a device path on the central Perilune server. Physical CSI validation
  remains pending.
- **IP camera:** use the vendor's RTSP H.264 endpoint where available. H.265 can be
  converted, with additional CPU cost. Proprietary cloud-only protocols are outside
  this release's target.
- **Existing go2rtc/Frigate:** continue using the existing external relay variables;
  Perilune does not mutate that relay's configuration as its managed companion.

Capture daemons, USB permissions and CSI drivers remain host-specific. See the
primary references in [the compatibility matrix](camera-compatibility.md).

## Limits and verification

The default companion limit is two CPUs and 384 MiB, configurable with
`PERILUNE_CAMERA_CPUS` and `PERILUNE_CAMERA_MEMORY`. Software conversion can be
expensive on small printer computers. Lower output resolutions reduce delivery
bandwidth; they cannot improve a low-frame-rate source. Hardware encoding is not
automatically selected by this release.

Shared viewers of a quality reuse its producer. Different qualities can require
separate conversion work. Unused producers stop when viewers disconnect. Tests
are bounded to two running and four retained/running drafts; media routing has a
separate concurrency bound. Companion restart is reconciled from private SQLite
settings without blocking app startup.

`node scripts/probe-camera-companion.mjs` checks real synthetic ingestion, sharing
and idle shutdown. After building, `node scripts/smoke-camera-setup.mjs` checks the
owner flow, actual browser decode, quality persistence, app/companion restarts,
JPEG refresh and authorization. Both require Docker, use generated media, and
remove their containers. Hardware performance, real Safari/native HLS and
representative USB/CSI acceptance are still coordinated device checks.

## Local USB capture

On a Linux server, the managed companion can discover and capture a USB/V4L2
camera directly. This is separate from importing a camera already served by
Crowsnest on a printer computer. The UI lists only profiles reported by the
companion, with their format, resolution and frame rate. Arbitrary device paths
and media-engine directives are not accepted from the browser.

Map one host camera into the companion using the additional override:

```sh
PERILUNE_CAMERA_DEVICE=/dev/video0 docker compose \
  -f compose.yaml -f compose.camera.yaml -f compose.camera-usb.yaml up -d
```

Prefer a stable host `/dev/v4l/by-id/...` path when available. Inside the companion
it becomes `/dev/video0`. No privileged mode or broad `/dev` mount is required.
Device access is explicitly enabled by the installer; a browser cannot grant it.

In Camera settings choose **USB camera on this server**, find local cameras,
select a detected profile, then test and save. H.264 avoids unnecessary encoding;
MJPEG and raw formats may require conversion. Close another capture process before
opening its device. Discovery offers each supported format's default profile;
custom resolution/frame-rate selection is not implemented yet. Unsupported driver
formats are omitted. Capture and unplug/replug behavior still need physical USB
acceptance; the adapter and profile lifecycle are covered by synthetic tests.

A CSI camera requiring libcamera/rpicam should continue through an appropriate
capture service on its Pi. Mapping a USB node is not a universal CSI setup method.
