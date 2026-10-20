# Document navigation review

Independent reviewer: `review_hard_navigation`. Approved after preserving client
navigation on ConfigurationEditor file links. The inherited reload policy would
otherwise destroy unsaved multi-file drafts and the calibration handoff on file
switches. All three file links explicitly opt out; existing configuration smoke
coverage remains intact.

The reviewer found no remaining blockers in server-selected Account sections,
ordinary links, unknown-section fallback or JavaScript-disabled coverage. Account
section changes now leave the page and discard unsaved local fields rather than
keeping hidden panels mounted. A future unsaved-notification warning is optional.
Display preference PATCH requests use keepalive to allow a pending small save to
finish when following an ordinary link. Imperative upload/calibration handoff
navigation remains explicit.
