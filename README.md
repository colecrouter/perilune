# Perilune

A reliable, thoughtfully designed control interface for Klipper printers.

Perilune is in early development. It places persistent Moonraker connectivity,
shared printer state, action tracking, and authenticated camera access behind a
self-hosted backend. The browser presents clear progress and reconnecting states
without throwing away inputs.

## Direction

- SvelteKit 3, Effect 4 and Effect language tooling, Vite+.
- Node.js initially; Docker Compose installation.
- SQLite persistence with Effect SQL.
- Live remote queries backed by process-owned services.
- Mobile-friendly controls, guided calibration, and explained printer configuration.
- Built-in authentication, slicer compatibility, notifications, and camera gateway
  integration follow as explicit milestones.

Licensed under GPL-3.0-only. See [LICENSE](LICENSE).
