# Push transport migration review

Independent `perilune-push-migration-review-1` found a test-fixture flake: Node ECDH
can omit private-scalar leading zero bytes. Both legacy fixtures now explicitly
pad to 32 bytes, matching the original web-push key generator's storage format.
The review found no production correctness blocker.

Final reviewer `perilune-push-migration-review-2` approved with no actionable
findings and independently passed 23 tests across transport and notification
service suites. It inspected raw-key/JWK compatibility, the pinned protocol patch,
JWT/wire encryption evidence, cancellation through response disposal, sanitized
errors, expiry cleanup, dependency/Docker patch inclusion and unreleased guides.

The independent Node crypto decoder exposed the dependency's native-endian record
size; the patch now emits network-order bytes. Other hunks preserve URI subjects,
forward AbortSignal and prevent redirect following. Tests verify the actual signed
claims, decrypted UTF-8/image payload, unchanged legacy identity/subscription,
TTL/urgency, HTTP failures/no retries, timeout, cancellation and response disposal.
No upstream repository changes or real push-provider requests were performed.

Parent focused tests passed; full pnpm validate and exact-head Docker/native
lifecycle CI remain merge gates and are recorded in the PR. Phone/app-closed and
provider acceptance remain separate owner checks; synthetic protocol verification
does not establish displayed delivery on any particular operating system.
