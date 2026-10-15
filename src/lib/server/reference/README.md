# Pinned Klipper documentation

`Config_Reference.md` is an unmodified snapshot from Klipper3d/klipper at the
revision in source.json. It is distributed under GPL v3; upstream COPYING is
included. See source.json for the exact source URL, SHA-256, and license link.

The prerendered `/reference/klipper.json` endpoint fetches that pinned URL during
the build, verifies its checksum, and extracts descriptive option examples. If
upstream is unavailable or returns different bytes, the verified identical
snapshot is used. No printer connection or private configuration is involved.

To update: select and review an upstream revision, replace the source and COPYING
from that revision without formatting them, update source.json, and run catalogue
extraction/variant tests and the full build. Never point the source URL at a moving
branch or infer validation/default values from commented examples.
