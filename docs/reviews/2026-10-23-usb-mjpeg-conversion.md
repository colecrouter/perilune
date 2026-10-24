# Local USB MJPEG conversion review

Independent review approved the MJPEG-only fix after one actionable finding:
raw Y4M forwarding in pinned go2rtc does not normalize packed/semiplanar pixels.
The Y4M path was removed; raw-only support remains unverified and documented.

The approved path uses a fixed companion-loopback HTTP MJPEG endpoint and a
validated opaque stream ID. H.264/HEVC and network routing are unchanged. The
managed companion configuration must retain internal API port 1984.

Focused verification: 35 tests across companion, setup and local discovery;
independent follow-up reran all 13 companion tests. Full local validation passed: 727 tests, production build, and all smoke suites.

Physical C270 acceptance used an isolated mapped companion and local app/database,
without changing the production camera. Native collaborative browser QA verified
USB discovery, test/save, H.264 decoding at 640x480 in two simultaneous tabs,
a valid JPEG snapshot, same-origin media and one shared V4L2 capture. No captured
media is committed. Driver detach/reattach emulation verified the reconnect state. Rebinding the
webcam USB device changed Linux video-node numbering; recreating only the
isolated companion using the stable device symlink restored playback without
camera reselection or app restart. This Docker mapping limitation and the recovery
command are documented. A physical cable unplug remains untested.

After both viewers navigated away, no FFmpeg process remained and fuser reported
no open camera handle. The isolated companion was then stopped. The production
camera configuration was unchanged; no printer motion/heating/config commands
were issued.
