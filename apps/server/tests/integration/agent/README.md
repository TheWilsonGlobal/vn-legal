# Agent acceptance tests (plan changes-02 / phase-01, TW1)

These tests drive a REAL server over HTTP. They are written from the contract
(plan section 6) and the acceptance criteria (section 10) before the feature
exists, so until B1 to B7 and RB1 land they fail for the reason "feature not
built". They import no server code (`setup-unit.ts` mocks `shared/config`
inside vitest) and never read `.env`.

## How the server is started

`helpers/harness.ts` spawns `node --import tsx apps/server/src/api/server.ts`
(no `tsx watch`) with `cwd` = repo root and:

- `NODE_ENV=development` (vitest sets `test`, which makes `server.ts` skip its
  boot block);
- a free `PORT`, `HOST=127.0.0.1`, a temp `AGENT_SESSIONS_DIR` under
  `os.tmpdir()`, `GEMINI_MAX_CONCURRENCY=2`, `AGENT_MAX_STEPS=4`,
  `LANGFUSE_ENABLED=false` (tests that care override it);
- everything else inherited; the child loads `.env` itself. "Missing" is
  always the empty string, never a deleted variable.

Offline tests that never need an answer point the chat endpoint at a dead port
or a local stub and use a fake chat key (`deadLlmEnv()`), so the real Gemini
key is never sent anywhere by them.

Every child is killed in `afterAll`. Temp dirs are removed. Nothing is written
under `storage/` or `data/`. The old store `storage/congraph_vectors.*` is only
hashed and copied (AC 42 / AC 39); it is never booted.

## Two groups

| Group                    | Files                                                                                                          | Needs                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Offline (default)        | `boot-refusals`, `sessions-api`, `llm-failure`, `persistence`, `langfuse`, `secrets`, `index-lock`, `rollback` | `.env` with keys and the RB1 index/manifests (a server must BOOT). No Gemini chat or embed request is made. |
| Live (`VN_LEGAL_LIVE=1`) | `live-agent`, `live-window`, `live-errors`, plus `[live]` tests inside `langfuse` and `rollback`               | live Gemini chat and embeddings, RB1 index                                                                  |

The live tests use `describe.runIf` / `it.runIf` on `VN_LEGAL_LIVE === "1"`.
There is no `.skip`. Without the flag they are reported as skipped:
**TR1 must report every skipped test as NOT RUN, never as passed.**

## Commands for TR1

Run from the repo root, one file at a time, concurrency 1:

```
# offline set
pnpm exec vitest run apps/server/tests/integration/agent --no-file-parallelism --reporter=verbose

# full set including live Gemini (Bash)
VN_LEGAL_LIVE=1 pnpm exec vitest run apps/server/tests/integration/agent --no-file-parallelism --reporter=verbose
# PowerShell
$env:VN_LEGAL_LIVE="1"; pnpm exec vitest run apps/server/tests/integration/agent --no-file-parallelism --reporter=verbose
```

Optional: `RB1_MANIFEST_PATH` overrides the default location of the RB1 manifest
(`storage/congraph_vectors_gemini-embedding-2_768.cgraph.manifest.json`) used by
the AC 39 positive check in `index-lock.test.ts`.

`RB1_PRERUN_HASHES` (REQUIRED for AC 39) is the path of RB1's pre-run list of
the old store (`pre-run-old-store-hashes.txt`: a header line, then
`name<TAB>size<TAB>sha256`). The `rollback` test "AC 39 hash check" compares
the current `storage/congraph_vectors.*` files named in that list against it.
When the variable is absent that test FAILS (it never skips), because without
RB1's own list the check would only compare the store with itself.

The vitest config already runs files on a single thread; `--no-file-parallelism`
is belt and braces. Server boot takes about 15 to 60 s (model and index load),
so expect the whole offline set to take several minutes.

## AC to test map

| AC  | File: test                                                                                      |
| --- | ----------------------------------------------------------------------------------------------- |
| 1   | `live-agent`: AC 1                                                                              |
| 2   | `live-agent`: AC 2                                                                              |
| 3   | `llm-failure`: AC 3 (both tests)                                                                |
| 4   | `live-agent`: AC 4                                                                              |
| 5   | `sessions-api`: AC 5                                                                            |
| 6   | `llm-failure`: AC 6 (abort, 409 busy)                                                           |
| 7   | `sessions-api`: AC 7 (C1 and C2, four bad bodies, 1000-char boundary)                           |
| 9   | `live-agent`: AC 9                                                                              |
| 17  | `live-agent`: AC 17                                                                             |
| 18  | `live-window`: AC 18                                                                            |
| 19  | `sessions-api`: AC 19 (HTTP half, offline); `live-agent`: AC 19 (recall half)                   |
| 20  | `persistence`: AC 20 (offline); `live-agent`: AC 20 (recall after restart)                      |
| 21  | `persistence`: AC 21 (torn line, corrupt index)                                                 |
| 22  | `sessions-api`: AC 22                                                                           |
| 25  | `persistence`: AC 25                                                                            |
| 27  | `langfuse`: AC 27 (offline) and `[live]` run                                                    |
| 28  | `langfuse`: AC 28 (offline) and `[live]` run                                                    |
| 29  | `langfuse`: AC 29 (offline) and `[live]` run                                                    |
| 31  | `langfuse`: AC 31 (two tests, see Windows note)                                                 |
| 32  | `secrets`: AC 32                                                                                |
| 34  | `boot-refusals`: AC 34                                                                          |
| 35  | `boot-refusals`: AC 35                                                                          |
| 36  | `llm-failure`: AC 36                                                                            |
| 37  | `llm-failure`: AC 37 (stub half, offline); `live-errors`: AC 37 (real Google)                   |
| 38  | `live-errors`: AC 38                                                                            |
| 39  | `boot-refusals`: AC 39 (refusals); `index-lock`: AC 39 (positive); `rollback`: AC 39 hash check |
| 40  | `secrets`: AC 40                                                                                |
| 41  | `index-lock`: AC 41                                                                             |
| 42  | `rollback`: AC 42; `boot-refusals`: AC 42 (one setting only)                                    |

## Things TR1 must know

- **Boot order.** The manifest check (`assertIndexManifest`) runs before the
  runner factory (plan 5.6). The AC 34 and AC 35 refusals are therefore only
  meaningful when the baseline `.env` boots (valid RB1 index). Otherwise they
  fail on the manifest line, which is correct.
- **AC 37 strictness.** Google may answer the literal key `invalid` with HTTP 400. Plan 5.3 maps 400 to `llm_error`, not `llm_auth_error`. The live test
  asserts `llm_auth_error` as written in AC 37; if it fails with `llm_error`
  that is a finding for the PM, not a reason to loosen the test.
- **AC 25 line number.** `first_bad.line` is asserted to be the 1-based line of
  the edited record. If B4 uses 0-based lines, the test fails and the PM must
  rule on the contract.
- **AC 32 / AC 40.** `git grep -lE` (file names only, never the matching line,
  because a hit might be a real key) over tracked and untracked non-ignored
  files, excluding `.env`. The patterns are built from fragments in
  `helpers/harness.ts` so this test tree does not match itself. The RB1 run
  log location is not fixed by the plan, so it is not scanned here; TR1 should
  run the same grep over it by hand.
- **Deviation from the plan's literal AC 40 regex.** The Google OAuth-style
  alternative (the letters A and Q followed by a dot) is anchored so that it
  must not follow a letter, digit or underscore. The unanchored form matches
  ordinary prose such as the word FAQ followed by a full stop. The other
  alternatives are unchanged. The two halves are exported separately from the
  harness (`LANGFUSE_GREP_ERE`, `GOOGLE_GREP_ERE`) because the anchored
  alternative contains a `|` itself.
- **AC 36 time budget.** The elapsed-time assertion is 12 s (10 s retry budget
  plus process overhead), not a loose multiple of it.
- **AC 31 on Windows.** `child.kill("SIGTERM")` is `TerminateProcess` on
  Windows: no JavaScript handler can run, so `langfuse shutdown ok` can never
  appear from a real signal. Two tests cover this honestly:
  1. the real `kill("SIGTERM")` must end the process within 6 s (on Windows the
     log line is NOT asserted, and the test title says so);
  2. a wrapper (`helpers/sigterm-wrapper/server.ts`, named `server.ts` so the
     server's main-module check passes) imports the real `server.ts` unchanged
     and, on an IPC message, calls `process.emit("SIGTERM")`, which runs the
     handlers the server registered. This asserts the shutdown hook itself
     (log line or timeout warning, exit within 6 s). It is an emulation of
     signal delivery, not an OS signal. On Linux and macOS test 2 sends a real
     SIGTERM. A real-signal check of the log line on Windows needs a Linux or
     WSL run and is NOT covered here.
- **AC 28 port.** The test uses `127.0.0.1:5998` as the plan says and asserts
  it is closed first.
- **Mocks.** Only the local upstream stubs in `llm-failure` (429, 401, hang)
  and the connection counter in `langfuse` (AC 29). They simulate upstream
  failure or observe outbound connections; the feature under test is real.
- **Fallbacks.** Langfuse fail-open is the only approved fallback; the tests
  assert it shows as a warn log and a C9 status and never fails a run.
