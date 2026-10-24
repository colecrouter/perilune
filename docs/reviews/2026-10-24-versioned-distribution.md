# Versioned distribution review

Independent implementation review approved after one P1 finding was resolved:
fresh backup volumes must be owned by the runtime node user. Docker now initializes
both data and backup directories. The lifecycle prepares only its old bootstrap
image’s disposable backup volume; candidate backup acceptance uses a separate
fresh volume with no manual permission fix.

Reviewed scope includes release workflows/permissions, identity and immutability,
manifest publication/draft assets, restore guards, version metadata and docs.
The reviewer did not run runtime validation or publish external artifacts.

Parent native ARM64 acceptance passed: install/bootstrap owner enrollment,
persistent marker and online backup, candidate upgrade with retained login,
candidate backup on a fresh volume, matching-secret restoration into another fresh
volume and old-image rollback/integrity verification. Disposable resources were
removed. No live printer connection was configured.

Documentation screenshots use only the simulator. Native preview snapshot timed
out twice; headless Playwright verified desktop/mobile layout, version display,
no page errors and captured three public synthetic screenshots. Local guide links
and actionlint passed. Full pnpm validation is running; native x86-64/ARM64 CI and
first public registry/bundle installation remain release gates.
