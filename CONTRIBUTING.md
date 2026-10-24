# Contributing to Perilune

Start with [development setup](docs/development.md) and [architecture](docs/architecture.md).
Use Node.js 24.13+, pnpm 12.11.2, the local Vite+ commands, and headless browser tests.
`pnpm format` formats supported files with Oxfmt and Svelte with Prettier.

Before a PR, run `pnpm validate`. CI also verifies the container and native
x86-64/ARM64 installation, upgrade and rollback. Substantial features and backend
lifecycle changes need independent code review before merge. Record findings and
resolutions in the PR. Explain behavior, validation and material limitations.

Update the relevant user guides and examples for every user-facing change.
Record the first release containing a new feature; keep unreleased changes marked
until tagged. Update architecture when implemented scope changes. Use synthetic
screenshots and link relevant issues. Release work must update release notes and
verify install/upgrade instructions, not just build an image.

Keep private hostnames, addresses, credentials, printer configuration and captured
media out of source, tests, screenshots and issue reports. Connections/workers are
process-scoped Effect services. Preserve drafts through state updates and reconnects.
Physical commands require bounded queues, idempotent IDs, execution-time checks,
expiry and unknown-outcome handling. Never blindly retry a physical command.

Development is a simulator by default. Real movement, heating, firmware/config
writes and destructive printer actions require coordinated owner testing. A green
synthetic test is not physical acceptance. Preserve the serif headings, warm
neutrals, teal and established lunar identity when changing UI.
