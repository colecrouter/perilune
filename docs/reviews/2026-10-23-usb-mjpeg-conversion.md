# Local USB MJPEG conversion review

Independent review approved the MJPEG-only fix after one actionable finding:
raw Y4M forwarding in pinned go2rtc does not normalize packed/semiplanar pixels.
The Y4M path was removed; raw-only support remains unverified and documented.

The approved path uses a fixed companion-loopback HTTP MJPEG endpoint and a
validated opaque stream ID. H.264/HEVC and network routing are unchanged. The
managed companion configuration must retain internal API port 1984.

Focused verification: 35 tests across companion, setup and local discovery;
independent follow-up reran all 13 companion tests. Full local validation is
running, including the production camera lifecycle smoke.

Physical C270 acceptance used an isolated mapped companion and local app/database,
without changing the production camera. Native collaborative browser QA verified
USB discovery, test/save, H.264 decoding at 640x480 in two simultaneous tabs,
a valid JPEG snapshot, same-origin media and one shared V4L2 capture. No captured
media is committed. Hardware unplug/replug and final teardown remain pending.
