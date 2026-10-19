# Beta UX readiness review

Independent reviewer: `review_beta_ux`. Result: approved after one actionable
finding was resolved. The reviewer inspected the complete change against main
for correctness, regressions, draft preservation, role/capability boundaries,
physical-action semantics and deployment assumptions.

The review found mode-blind Z-calibration status labels that described a discard
operation as saving. Pending, uncertain and failed discard labels now identify the
operation correctly; three regression cases cover those states. The reviewer
approved that correction and the later mobile file browser, authenticated-login
redirect (including recovery-fragment preservation), read-only thermal summary,
shared action labels, healthy recovery disclosure and empty pending-review state.

No backend execution or deployment configuration changes are included. Physical
commitment, explicit browser approval, exact configuration review, recovery locks
and no-replay rules remain in place. Browser checks use synthetic data; no real
printer action was performed. Full validation and CI results are recorded in the
PR before merge.
