# Personal display preferences

Account → Make yourself at home contains typography, default file page size and
temperature-history window choices. Console filters, internal-macro visibility,
response grouping, explicit Follow latest choices and file-table columns also
save when changed in their workspace. The overview no longer carries the
experimental typography switch. Serif headings remain the default.

These defaults belong to the signed-in account and are loaded when opening
Perilune on another device. Explicit Jobs URL parameters take precedence over the
saved page-size default. Existing open tabs do not receive a live preference
broadcast; concurrent changes to separate fields merge without replacing each
other. Same-field changes use the last accepted update.

Changes apply immediately in the current tab. A bounded queue coalesces edits
while a save is pending. Save failures retain the local choices and offer Retry;
they do not replay printer actions. Switching accounts or signing out clears
that account's local state and fences delayed save responses.

Only the defined display fields are stored. Search/input drafts, selected files,
physical commands, calibration values, temporary expanded output and the console's
automatic pause while reading older messages are not preferences. Per-file editor
mode choices retain their existing session lifetime. Macro shortcuts already have
separate account-owned storage. Notification subscriptions, OS permissions and
per-device notification delivery choices remain device-specific.

Migration 020 adds `user_preferences`. The process-owned Effect service uses
atomic JSON field patches, with authentication-derived ownership, bounded request
bodies and same-origin validation on writes. Server rendering uses the account's
saved defaults; if that optional read fails, printer state remains available with
an explicit preference fallback message. Preferences require no printer opt-in
or hardware testing.
