# Shared page content width

Unreleased: shared page frames now cap their centered outer width at 76rem,
including gutters. Configuration and Jobs opt into the existing 100rem measure.

Independent static review approved with no actionable findings. It checked the
CSS cascade, border-box sizing, explicit wide variants, existing grid constraints,
mobile gutters and documentation. No runtime or deployment behavior changed.

Parent verification: production build and 792 tests passed. A temporary headless
browser check inspected 15 routes at 2560, 1920, 1280 and 390px (60 scans), checking
frame bounds, overflow and page errors. Overview Customize opens and dismisses.
Synthetic desktop/mobile screenshots were inspected outside the repository.
Native collaborative preview confirmed Overview at 1920px has a 1216px frame and
two panel columns, and at 390px has no horizontal overflow. Full validation and
CI remain release gates.
