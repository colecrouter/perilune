# Camera compatibility foundation review

Independent reviewer: `review_camera_foundation`.
Result: approved after two actionable test-harness findings were resolved.

- Bounded Docker subprocess calls so the local probe cannot wait indefinitely.
- Replaced a fixed viewer-release delay with bounded state polling.
- Also ensured temporary configuration cleanup runs if container shutdown fails.

The reviewer checked lifecycle cleanup, fixture isolation, resource limits,
CI assumptions and the distinction between verified engine behavior and pending
application/browser/hardware acceptance. No production camera behavior changes
in this foundation slice. Final local ARM64 rerun passed all four media paths;
CI provides the additional runner-architecture check.
