Second alpha; updates are explicit and the first release remains unchanged.

- Pairing submissions stay disabled until browser handlers are ready, preventing
  an early click from submitting the plain HTML form without creating a code.
- Release retries verify both platform image configs, supporting registries that
  omit optional OCI index annotations while still refusing source/version mismatches.

This release exercises installation, account retention, online backup, upgrade
from the preceding tagged release and matching-backup rollback on native Linux
x86-64 and ARM64. See the included upgrade guide before changing versions.

Perilune remains an early alpha. Physical printer controls are opt-in and require
attended acceptance. No command with an unknown outcome is automatically replayed.
