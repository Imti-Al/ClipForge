# Targeted P1 foundation pass

## Responsibility map

- `electron/media/binaries.js`: bundled FFmpeg/ffprobe resolution, with the existing
  development locations and packaged resources directory; no PATH fallback.
- `electron/media/probe.js`: raw probe JSON and normalized metadata.
- `electron/media/ffmpegRunner.js`: process spawning, progress parsing, process
  errors and output-collision preflight. No job queue or cancellation framework.
- `electron/media/export.js`: existing CPU/NVENC arguments and MP4/MKV execution.
- `electron/media/remux.js`: existing stream-copy remux execution.
- `electron/projects/paths.js`: sidecar naming and explicit project extensions.
- `electron/projects/schema.js`: structural validation, metadata and migration.
- `electron/projects/store.js`: reads, serialized atomic writes, sidecar/explicit
  saves, and delete-on-exit tracking.
- `electron/paths.js`: shared path comparison and safe-file prefix handling.
- `electron/files.js`: existing temporary import, cleanup and cross-device move.
- `electron/ipc.js`: common request result envelope.
- `src/utils/ipc.ts`: renderer-side result unwrapping, without Node APIs.

`electron/main.js` now retains lifecycle, native dialog definitions, and thin
request registrations. `electron/preload.js` exposes an explicit request
allowlist and per-subscription progress cleanup. Its allowlist stays local because
the sandboxed preload cannot require arbitrary application modules.

Other changed files in P1: `src/types/electron.d.ts`,
`src/components/MainEditor.tsx`, `src/components/ExportModal.tsx`,
`src/components/RemuxModal.tsx`, `tests/p0.cjs`, and `tests/editor.cjs`.
Added tests: `tests/helpers/electron.cjs`, `tests/p1.cjs`, `tests/ipc.cjs`.
Earlier P0 working-tree changes were retained. Packaging configuration was not
changed during P1; its existing `electron/**/*` include covers the new modules.

## IPC contracts

Request and progress channels use camelCase. All asynchronous requests resolve to
`{ success: true, data }` or `{ success: false, error, code }`. Dialog cancellation
is a successful `null` (or an empty array for multi-file selection), not an error.
Progress subscriptions and synchronous `getPathForFile`/`platform` are not request
channels. Transport failures can still reject a promise, so callers retain catches.

The caller audit found no renderer use of the following legacy aliases, which
were removed from preload and main: `project-default-path`,
`project-save-sidecar`, `project-open-sidecar`, `project-exists`,
`project-set-delete-on-exit`, `is-temp-import`, and `move-file`.

Renamed internal channels: `open-video-dialog`, `get-video-info`, `export-video`,
`remux-video`, `select-mkv-files`, `show-save-video-dialog`, `export-progress`, and
`remux-progress`. No parallel old channel registrations remain.

Also removed unused `selectOutputDirectory`/`select-output-directory` and the
global `removeExportProgressListener`/`removeRemuxProgressListener` methods.
Callers already use the unsubscribe function for their own listener.

No IPC compatibility aliases remain: main, preload and renderer ship together,
and their current callers are covered by contract tests. Existing export option
synonyms (`useGpu`, `format`, `endTime`, `targetSize` mode) remain in the media
service to avoid changing existing media behavior. Project extensions are not
IPC aliases and both remain supported.

Probe errors now use the failure envelope instead of looking like successful
zero-duration metadata. The editor uses its existing error display, and remux
continues to admit a file when its duration cannot be probed. Export/remux error
messages, including collisions, reach the existing UI error displays.

## Project compatibility

- Both `.clipforge` and ClipForge's older `.llc` files remain readable/writable.
  This does not claim support for unrelated applications' project schemas.
- Absent versions default to `1.0.0`; existing valid `0.x.x`/`1.x.x` versions and
  `createdAt` are preserved. Saves update `lastModified`.
- A legacy selection without a segment array is migrated in memory to one main
  segment. Existing multi-segment arrays are left intact. Opening does not itself
  rewrite the file.
- Structural validation rejects non-object JSON, invalid field containers and
  invalid/unsupported version strings. Future major versions fail clearly rather
  than being silently overwritten.
- Unknown fields are retained by the schema/store operations. The existing
  renderer serializer still writes its known fields; this is not a general
  lossless round-trip guarantee for unknown extension fields.
- P0 renderer reconciliation still handles bounds and active IDs using fresh
  probed duration. No selection behavior or React state architecture was changed.

## Verification and remaining debt

Stages 1 and 2 passed their full checks before the IPC stage. Final Stage 3:

- `node --test tests/*.cjs`: 25 passed, 2 explicitly skipped artifact-dependent
  checks, 0 failed.
- `npm run lint`: passed.
- `npm run build:ui`: passed; existing stale Browserslist warning remains.
- `npx tsc --noEmit -p tsconfig.app.json`: passed.
- `npx tsc --noEmit -p tsconfig.node.json`: passed.

Tests cover the existing editor save/autosave invariants, media arguments and
progress, real filesystem project saves/migrations, canonical IPC registration,
preload/type agreement, errors, cancellation, and subscription cleanup.
The Electron test loader uses real source modules with mocked Electron/process
dependencies. It is not a fresh packaged-application smoke test.

Remaining debt: main still owns native dialog definitions; renderer project-state
orchestration remains sizable; schema migration covers known ClipForge shapes,
not arbitrary historical formats. Existing shutdown cleanup remains best-effort.
Backend JavaScript does not yet have full static type checking. A new packaged
smoke test is needed before distributing this refactor. No P2/P3/P4 work was done.
