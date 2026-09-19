# Media lifecycle verification

## Ownership and cleanup

- Export and remux requests carry a unique job ID. Cancellation is scoped to the initiating renderer; progress carries the same ID.
- Both x264 passes belong to one job. Cancellation stops the current process, waits for its exit, and removes the unique pass-log directory. A process that does not exit receives SIGKILL after one second.
- FFmpeg writes to a private directory beside the destination. Only a successful encode is published. Publication uses a non-replacing hardlink, with exclusive-copy fallback on volumes without hardlinks. Publication is a non-cancellable commit point; cancellation requests arriving after it return false.
- Failure/cancellation removes staging data, not pre-existing destinations. An OS crash, forced termination, unavailable drive, or filesystem permission failure can still prevent cleanup. Exclusive-copy publication is not atomic on volumes without hardlink support.
- Window close cancels the window's jobs and requests a renderer project flush before approving close. Failed or five-second-stalled saves leave the editor open with an error. If the renderer cannot respond at all, the window is destroyed after seven seconds; unsaved renderer-only edits cannot be recovered in that case. Main-process shutdown waits for job cleanup and queued project writes, with a six-second upper bound. Short probes have timeouts and are aborted on shutdown.
- Temporary imports belong to the application instance. Shutdown never recursively deletes the shared import root. Startup can remove imports older than 24 hours only when their recorded owner is no longer running. PID reuse may conservatively retain an abandoned import.

## Source loading and imports

- Source-open intent increments a generation before dialogs, project reads, probing, or blob transfer. Only the current generation can install source state or report load errors. The prior source remains intact until the replacement is ready and prior edits are saved.
- Path-backed drops use the original path without copying. Blob-only files use sequential 1 MiB slices, each acknowledged before reading the next. IPC cloning adds bounded copies of that chunk, not a whole-file buffer. This does not bound decoder/browser memory or memory already owned by an external blob producer.
- Supersession, transfer failure, window destruction, and shutdown clean incomplete imports. Imported media remains temporary and receives no automatic sidecar. Explicit permanent Save behavior is unchanged.

## Automated checks

```powershell
node --test tests/*.cjs
npm run lint
npm run build:ui
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.node.json
Get-ChildItem electron -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
node tests/tools/media-lifecycle-smoke.cjs
```

The unit suite covers job ownership, cancellation/kill escalation, publication collisions, two-pass cleanup, shutdown ordering, stale loads, bounded/interrupted imports, and export/remux cancellation controls. Packaging tests requiring a packaged artifact skip without `CLIPFORGE_PACKAGE_DIR`.

The real-process smoke script exercises CPU, two-pass CPU, available NVENC, remux, failed outputs, collisions, and shutdown. It uses actual bundled binaries with only Electron lifecycle stubbed and writes its report to a dedicated OS temporary directory.

`electron tests/tools/reliability-electron-smoke.cjs` uses production UI, preload, main, and real processes. Native picker responses are supplied by the test. It checks the Export Cancel control, a synthetic blob-only drop, no temporary sidecar, and native close during encoding with a pending project edit. It writes a screenshot and report to its printed temporary directory. Redirect Electron stdout/stderr when launching it directly on Windows.

## Manual coverage still useful

- Explorer drop versus a genuine multi-gigabyte blob producer; observe memory over the entire import.
- Cancel a remux batch on a slow drive, then retry its cancelled/waiting rows.
- Slow/unavailable network destinations, external FAT/exFAT drives, disk-full and antivirus/file-lock conditions.
- OS-forced termination or power loss: normal `finally` cleanup cannot be guaranteed.
