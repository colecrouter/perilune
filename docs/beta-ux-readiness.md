# Beta UX readiness

Scope accepted in issue #105. The research covered everyday printing, workshops,
configuration, account access and the shared shell using source review and a
synthetic simulator. It found that controls and results were often several screens
away from the task, with mobile navigation concealing secondary destinations.
The existing warm neutral/teal palette, serif headings and restrained lunar
identity remain the visual foundation.

## Work packages

- Shared navigation, focus, controls and layout patterns.
- Reachable everyday controls, jobs, console and contextual outcomes.
- Consistent calibration preparation, progress, result and save state.
- Searchable, grouped configuration with discoverable draft review.
- Direct account sections, contextual entry/pairing and notification feedback.
- Responsive, keyboard, dark mode and exceptional-state verification.

## Acceptance

Common controls should be reachable in the initial task viewport. Each operation
has a stable place for pending, confirmed and uncertain results. Configuration
review and account sections are discoverable without reading unrelated content.
Mobile navigation exposes every destination through an explicit control.

Check 320, 390, 768, 1024 and 1440 CSS-pixel widths, including dialogs and menus.
Allow intentional local code/table scrolling; avoid document overflow. Check
keyboard focus, zoom, long content, light/dark, roles, reconnects and failed or
unknown outcomes. Target 44px for primary touch controls without shrinking text.

Preserve drafts, auth/permission semantics, physical attendance and confirmation,
exact change review, source conflicts, idempotency and no-replay recovery. Validate
with meaningful regression coverage, `pnpm validate`, Docker CI and independent
review. Use synthetic fixtures; hardware acceptance remains separately tracked.

Email infrastructure, an ORM migration, camera transcoding, a dashboard builder,
and durable automatic extrusion-setting application are outside this scope.
