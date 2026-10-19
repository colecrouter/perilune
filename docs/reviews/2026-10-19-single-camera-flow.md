# Single camera setup flow review

Independent reviewer: `review_single_camera_flow`. Result: approved after fixing
an updated smoke fixture's duplicate variable declaration and clearing the new
companion variable in unrelated simulator smoke environments.

The reviewer checked the single process-owned source setter, startup restoration,
disconnect/session invalidation, explicit Moonraker candidate selection, migration
documentation and deployment assumptions. No remaining correctness, authorization
or lifecycle findings.

The live installation was migrated through the existing owner test/preview/save
API using its private RTSP source. H.264 probing, snapshot preview and media delivery
passed. An authenticated headless browser decoded the saved source at 2880 × 1616.
No private frames, source endpoints or credentials were recorded in the repository.

The media fixture now uses the managed API for initial and replacement sources;
its held-media route includes quality queries. Gateway unit tests verify that
disconnect clears configuration without restoring a hidden source. Existing media
coverage retains decode, source changes, invalidated sessions, orientation, drafts,
mobile layout and pause/reconnect. Validation results are recorded in the PR.
