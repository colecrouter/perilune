# Separate new mesh and replacement review

Independent design and implementation reviews approved the final change with no
remaining actionable findings. The final reviewer independently passed 55 focused
tests across domain, service, persistence and headless component suites.

New calibration uses an explicit, absent-by-default session flag and a private
runtime profile. Save as requires a unique nonreserved name; Replace retains its
selected target and rejects naming/copy options at admission and execution. The
simulator follows the same saved-inventory contract. Existing legacy staged-copy
metadata remains available for discard/recovery.

Design review identified Klipper's null tombstone after temporary removal, which
must not be mistaken for an absent pending entry. Persistence now checks the mixed
manifest against captured absence evidence: exactly the reviewed new candidate and
its owned temporary tombstone, without unrelated changes. Raw source/header checks
and effective/loaded configuration checks protect name uniqueness. Discard can
handle interrupted temporary cleanup or an empty pending set only with this new
profile evidence and unchanged baseline sources. Both preliminary and final
persistence checks apply that rule.

Discard intent is journaled before restart. A lost compensation-restoration
acknowledgement keeps the workflow uncertain; read-only reconciliation does not
close it while the previous active mesh is missing. Fresh explicit restoration
can finish without repeating an already verified restart. Its regression proves
one restart, unresolved read-only recovery, and a separate explicit activation.

Production simulator and loopback live smokes pass new-profile creation while
retaining existing saved profiles, reviewed persistence, discard and deletion.
Native preview snapshots twice failed with `Preview automation snapshot timed out
after 15000ms.` Repository headless Playwright provides rendered QA. No real
printer commands have been issued. Full validation and Docker CI are release gates.

Final headless rendered QA passed desktop new preparation/Save as, named profile
creation preserving both baseline profiles, fixed-target replacement with no
naming/copy control, 320px confirmation layout and inventory persistence after
reload. There were no page errors or horizontal overflow. Full local validation
is running; its result will be recorded in the PR before release.
