# Targeted media accuracy pass

## Checkpoint and scope

- Checkpoint commit: `1ab5a23` (`Checkpoint before media accuracy + UI redesign`).
- Annotated return tag: `pre-ui-redesign`.
- The checkpoint includes all prior P0/P1 code and tests. The existing 586,478,257-byte recording in `clips/` was left untouched and untracked, not embedded in Git.
- This pass's changes are uncommitted. No UI redesign, project persistence changes, new encoders, queues or cancellation framework were introduced.

## Confirmed problems and fixes

- Target mode previously assigned the whole size to video, then added audio. Its MB-to-kb/s calculation also mixed binary and decimal units.
- A shared backend budget now defines MB as 1,000,000 bytes, reserves audio, reserves max(16,384 bytes, 1%) for muxing and a further 2% CPU / 6% NVENC safety margin, then rounds video bitrate down to whole kb/s.
- Re-encoded audio reserves the existing AAC 128,000-bit/s setting; absent audio reserves zero. Copied audio uses the first mapped audio stream's positive `bit_rate`, `BPS` or `BPS-eng` metadata.
- Unknown copied-audio bitrate is not silently guessed: target mode asks the user to disable audio copy. CRF/CQ copy behavior is unchanged. Insufficient/invalid size budgets fail clearly before encoding.
- CPU target mode uses sequential x264 passes within one export promise, matching trim/video settings in both passes and audio only in pass 2. Each operation has a unique temporary passlog directory, removed in `finally` on success/failure. Output collision checking repeats after analysis and `-n` remains in the output process.
- NVENC target mode uses explicit VBR, full-resolution internal multipass, capped maximum bitrate and a two-second VBV buffer. This is one NVENC process, not x264-style offline two-pass encoding.
- The fake fixed-curve CRF/CQ estimate was removed. The existing estimate area now states that size is variable. Target estimates use the exact same backend budget as execution, with audio/video allocation and approximation notes; debouncing and stale-response protection avoid outdated estimates.
- FFmpeg stdout now supplies structured `-progress pipe:1` records. A buffered line parser handles split chunks. Progress represents both CPU passes, never decreases and is capped at 99 until the caller receives success. Speed uses an exponential moving average, carried between passes; ETA uses remaining total pass work, not just the current selection's remaining playback time.
- Stderr retains only its last 65,536 characters for diagnostics. Incomplete progress lines are also bounded.
- A cached, timeout-bounded runtime NVENC initialization test runs before enabling the existing toggle and is also enforced by the export backend. Real testing caught and corrected an initially too-small probe frame: this GPU rejects 128x128, so the probe uses one 640x360 frame.
- Already correct and preserved: active-selection duration, MP4/Matroska restrictions, first-audio-stream mapping and MP4 copy compatibility checks, bundled binaries with no PATH fallback, CPU CRF/NVENC CQ distinction, multi-segment editing and project sidecar flows.

## Real encode measurements

Windows, repository-bundled FFmpeg/ffprobe, actual CPU and NVENC processes. The harness stubs only Electron lifecycle integration; it does not mock encoding, probing, files or progress. No new packaged installer or interactive Electron GUI was tested in this pass.

Input: generated 20-second 1280x720/30fps testsrc2 video with seeded pink-noise audio encoded as AAC 192 kb/s. Every target export begins at 2 seconds. Presets: CPU medium, NVENC p5. Before measurements reproduce checkpoint `1ab5a23` target-mode command arguments, not an older installed application.

| Encoder | Requested MB | Selected seconds | Audio / container | Before bytes (deviation) | After bytes (deviation) |
| --- | ---: | ---: | --- | ---: | ---: |
| CPU | 1 | 4 | AAC 128k encode / MP4 | 1,067,459 (+6.746%) | 966,574 (-3.343%) |
| CPU | 2 | 10 | copied source AAC / MP4 | 2,288,381 (+14.419%) | 1,960,165 (-1.992%) |
| CPU | 4 | 16 | AAC 128k encode / MKV | 4,345,199 (+8.630%) | 3,884,140 (-2.897%) |
| NVENC | 1 | 4 | AAC 128k encode / MP4 | 1,344,633 (+34.463%) | 988,497 (-1.150%) |
| NVENC | 2 | 10 | copied source AAC / MP4 | 2,587,266 (+29.363%) | 1,876,525 (-6.174%) |
| NVENC | 4 | 16 | AAC 128k encode / MKV | 4,583,687 (+14.592%) | 3,782,567 (-5.436%) |

Probed output durations were 4.000, 10.010333 and 16.021 seconds respectively (audio packet/mux timestamp granularity). All had H.264 video. Real progress assertions confirmed sequential pass coverage, monotonic percentages and no premature 100. Additional actual CPU CRF, NVENC CQ, MKV-to-MP4 remux and existing-output collision checks passed.

Raw CPU report: `C:/Users/imti/AppData/Local/Temp/clipforge-accuracy-5lKn8c/results.json`.
Its capability result records the initial too-small probe failure; CPU measurements are valid.
Corrected NVENC report: `C:/Users/imti/AppData/Local/Temp/clipforge-accuracy-rw8BgN/results.json`.
Generated media and results remain in these temporary directories, not in the repository.

Reproduce: `node tests/tools/media-benchmark.cjs` from the repository root. Optional `--gpu-only` runs only the hardware cases. Each invocation uses a fresh temporary directory and never overwrites prior outputs.

## Changed files

- New `electron/media/budget.js`: shared target budget calculation.
- New `electron/media/capabilities.js`: lightweight NVENC runtime check.
- `electron/media/export.js`: budget consumption, two-pass CPU flow, NVENC VBR configuration, target estimate service and scoped log cleanup.
- `electron/media/ffmpegRunner.js`: structured progress, total-pass progress, smoothed ETA and bounded diagnostics.
- `electron/main.js`, `electron/preload.js`, `src/types/electron.d.ts`: two matching camelCase request contracts, `getExportEstimate` and `getEncoderCapabilities`, plus progress/estimate types. Existing IPC result envelopes are preserved; no old handlers/aliases were removed in this pass.
- `src/components/ExportModal.tsx`: truthful estimate text, capability gating and backend ETA consumption, with web-preview fallback. No layout redesign.
- New `tests/media-accuracy.cjs`: seven focused backend scenarios, including budget edge cases, two-pass completion/failure/collision/unique logs, buffered progress, bounded diagnostics and capability handling.
- New `tests/export-dialog.cjs`: three renderer scenarios for estimates, stale responses, capability gating, job ETA/completion and missing preload.
- `tests/p0.cjs`, `tests/p1.cjs`: fake child processes updated for structured stdout; original behavior assertions retained.
- `tests/helpers/electron.cjs`: optional real OS dependency for actual process benchmarking.
- New `tests/tools/media-benchmark.cjs`: reproducible real-process before/after benchmark.
- New `tests/MEDIA-ACCURACY.md`: this report.

## Verification and remaining limitations

- `node --test tests/*.cjs`: 35 passed, 0 failed, 2 packaged-artifact-dependent tests skipped.
- `npm run lint`: passed.
- `npm run build:ui`: passed; existing outdated Browserslist database warning remains.
- `npx tsc --noEmit -p tsconfig.app.json`: passed.
- `npx tsc --noEmit -p tsconfig.node.json`: passed.
- Final progress smoothing across passes was covered by regression tests after the real encode run; it does not change encoder arguments or output bytes.
- These samples are not a hard filesize guarantee. VBR content variation, copied-audio segment bitrate differing from the source average, very short clips, metadata and packet overhead can still affect size. NVENC and easy-to-compress content can substantially undershoot. No padding or truncating `-fs` limit is used.
- ETA remains approximate, especially when the analysis and final passes run at different speeds; it does not predict file-finalization latency. NVENC initialization results are cached for the app session; later device/driver/resource failures still surface as normal export failures, without silent CPU fallback.
- Passlogs are cleaned on handled success/failure. Forced process termination or an OS cleanup failure can still leave temporary files; no crash recovery framework was added.
- Deferred: optional representative short-sample CRF/CQ estimation with uncertainty intervals (not a promise and not a full pre-encode), broader real-world/VFR/very-short-clip testing, new packaged GUI smoke testing and all UI redesign/broad P2/P3 work.
