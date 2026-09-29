# SDD ledger — plan: docs/plans/2026-09-29-git-sync.md
Task 1: minor (deferred): sanitizeDeviceName doesn't handle Windows reserved names (CON/NUL/COM1) or very long names
Task 1: minor (deferred): no tests for dotfile/multi-dot paths in conflictCopyPath
Task 1: minor (deferred): --experimental-vm-modules prints ExperimentalWarning in test output
Task 1: complete (commits b4fa824..2d54eb5, review clean)
Task 2: minor (deferred): redact replaces secrets in list order (substring secrets partially masked); URL-cred regex stops at first '@'
Task 2: minor (deferred): redact tests lack multi-secret / no-credential URL cases
Task 2: complete (commits 2d54eb5..1f82351, review clean)
Task 3: minor (deferred): config writes not atomic; readJson accepts non-object JSON (null -> TypeError); writeFileSync ENOENT if dir missing
Task 3: complete (commits 1f82351..bdc9c5b, review clean)
Task 3: minor (deferred): commit bdc9c5b trailer says 'Claude Haiku 4.5' instead of the required 'Claude Opus 5.5'
Task 4: plan deviation accepted: credential-helper test uses replace(/\n$/,'') instead of trim() (plan assertion was wrong)
Task 4: minor (deferred): unused fs/path imports in sync.test.mjs; unused dir params in mergeRemote/syncDown; double statSync
Task 4: minor (deferred): no tests for case-collision block path, token-not-in-.git/config, push-rejected retry; large-file test doesn't assert no local commit
Task 4: minor (deferred): timeout.block 120s may kill long pushes on slow mobile links
Task 4: fix round 1/5 (2 addressed, 1 open — push retry regex '[rejected]' unescaped character class; commits ea65cf2..7871329)
Task 4: fix round 2/5 (1 addressed, 0 open; commits 7871329..0a80e51)
Task 4: complete (commits bdc9c5b..0a80e51, review clean)
Task 5: minor (deferred): no add/add conflict test; modify/delete tests don't verify resolution is pushed/stable; freeCopyPath checks worktree only; updated:true when only "kept local"
Task 5: fix round 1/5 (2 addressed, 0 open; commits c396f41..6d7479c)
Task 5: minor (deferred): hook-based abort test relies on #!/bin/sh (fine on Windows/Linux; Termux untested); merge --abort failure is swallowed
Task 5: complete (commits 0a80e51..6d7479c, review clean)
Task 6: minor (deferred): BRANCH_PATTERN accepts invalid refs (a..b, x.lock, trailing /); AUTH_ERROR \b40[13]\b may misclassify; /status swallows getStatus errors without logging; no way to clear token; tests don't cover init route / lock release after error / empty token
Task 6: fix round 1/5 (3 addressed, 0 open; commits 07ef82b..786151f)
Task 6: minor (deferred): repoUrl saved before hardening isn't re-sanitized
Task 6: complete (commits 6d7479c..786151f, review clean)
Task 7: minor (deferred): refresh() after failed save overwrites typed fields; settings.html fetch not checked; result arrays not defaulted; success toast hidden by reload; no explicit double-click guard
Task 7: complete (commits 786151f..d41830d, review clean)
Task 8: complete (commits d41830d..33d2d98, review clean; steps 5/7 manual, pending with user)
