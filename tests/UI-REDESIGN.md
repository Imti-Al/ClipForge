# ClipForge UI redesign

## Scope and checkpoints

Media accuracy remains committed at `41d3ba2`, tagged `ui-redesign-base`.
`pre-ui-redesign` still resolves to `1ab5a23`. Renderer changes are uncommitted.
No Electron, preload, project or media backend files changed in this pass.
No user recordings were added, moved or modified.

## Design

- Graphite surfaces, restrained lime selection/action accent, local Windows typography and tabular timecodes.
- Preview-first workspace, compact right-hand clip list, collapsible source information and full-width timeline.
- Active clip tabs/list highlighting, distinct playhead and trim handles, labeled editable IN/OUT fields, mark-at-playhead buttons, keyboard-accessible sliders and explicit active-clip export.
- Direct Open action and drop guidance; save/temporary-source/error notices stay outside the preview.
- Clickable File menu retains working actions. Previously nonfunctional Edit/View/Help placeholders were removed, not working features.
- Export separates Quality/Target Size and CPU/NVENC, retains capability gating, exposes advanced preset/audio settings on demand, and keeps truthful filesize text in its footer.
- Running exports show a compact progress/ETA view. Remux has consistent batch rows, progress, completion and expandable collision/error details.
- Shared dialog shell provides scrolling, focus containment/restoration, Escape/backdrop close and busy-state dismissal protection.
- Native file pickers and the OS window frame remain visually unchanged.

## Files

Substantially changed: `src/App.css`, `src/components/MenuBar.tsx`, `Sidebar.tsx`,
`Timeline.tsx`, `VideoPreview.tsx`, `ExportModal.tsx`, `RemuxModal.tsx`.
Targeted integration changes: `src/App.tsx`, `src/main.tsx`, `src/components/MainEditor.tsx`.
Added: `src/components/Dialog.tsx`, `tests/ui.cjs`, `tests/tools/ui-smoke.cjs`.
Updated renderer fixtures/assertions: `tests/editor.cjs`, `tests/export-dialog.cjs`.

## UI fixes

- Main editor shortcuts cannot trim, seek or toggle playback behind a modal.
- Paused preview seeks use a sub-frame tolerance; frame stepping pauses playback before seeking.
- Stable time formatting prevents playback renders from resetting a partially typed trim timecode.
- Tailwind reset loads before app styling, so controls retain their intended padding.
- Dialog content scrolls independently while actions and the filesize summary remain visible.
- Sidebar resize cursor styling is cleaned up when the resize interaction unmounts.

## Verification

- Regression suite: 39 passed, 0 failed, 2 packaged-artifact checks skipped.
- Lint, production UI build and both TypeScript configurations passed.
- Existing Browserslist database warning remains; no dependencies were changed to suppress it.
- Real Electron production-renderer smoke run at 1200x700, 1400x900 and 1920x1080.
- Actual preload/IPC, local source open and ffprobe, segment selection, editable ranges, single-frame seeking, modal shortcut isolation, CPU two-pass export, export collision, two-file remux and remux collision states were exercised.
- Native picker responses were supplied by the test; the media services and filesystem were real. Generated fixtures only.
- Screenshot/DOM overflow checks passed. Screenshots were visually inspected for editor, empty state, File menu, export quality/target/advanced/running/error and remux states.
- Final screenshots and machine-readable report: `C:/Users/imti/AppData/Local/Temp/clipforge-ui-FupxPe/`.
- Expected renderer console message `Export failed` comes from the deliberate collision test.

Run `npm run build:ui`, then `npx electron tests/tools/ui-smoke.cjs` from the repository root.
The harness generates local fixtures, uses an isolated profile/temp directory, and exits after testing.
It does not validate native window-close/autosave teardown.

## Manual follow-up

Check native Explorer file dragging (the automated test dispatches a local-path drop),
pointer-handle feel and sidebar resizing, high-DPI/multiple-monitor scaling, native close
with a pending edit, and NVENC export through the redesigned dialog on your normal recordings.
The NVENC backend/capability regressions passed, but this UI smoke run exported with CPU.
A new installer was not built or tested. No UI redesign follow-up or unrelated backend work
has been started beyond this pass.
