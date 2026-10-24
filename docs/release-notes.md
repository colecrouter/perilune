First public alpha of Perilune’s versioned distribution. Existing users evaluating
source deployments should preserve their current mounts and private environment;
the standard install bundle uses explicitly named data and backup volumes.

- Linux x86-64 and ARM64 container images, tested on native runners.
- Digest-pinned install bundle, checksums, source/image metadata and version display.
- Documented owner setup, read-only Moonraker connection, cameras and slicer pairing.
- Verified backup, upgrade and fresh-volume rollback with retained accounts/secrets.

Perilune remains an early alpha. Live controls and configuration writes are opt-in
and require attended testing. Keep another printer interface available. Raw-only
USB cameras and physical unplug/replug coverage remain limited; see camera docs.

The automatically generated change list below includes repository changes. For
an overview of supported workflows, read the documentation index in the bundle.
