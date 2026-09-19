# ClipForge

A personal desktop app inspired by [LosslessCut](https://github.com/mifi/lossless-cut)—same general idea (open a video, set in/out, export, keep small project files), but **not** focused on lossless workflows. It’s built for how I like to work, with extra features I wanted.

**Stack:** Electron + Vite + React + TypeScript, FFmpeg for probe/export/remux.

**Status:** Early / under active development. Expect rough edges and changing behavior.

## What it does (today)

- Open videos (file dialog or drag-and-drop)
- Timeline with playhead and in/out trimming
- Multiple segments, project sidecars (`.clipforge`), autosave
- Export (encode) and batch-style remux helpers where applicable

## Development notes

ClipForge requires bundled FFmpeg and ffprobe binaries for probing, export, and
remux operations. The Windows binaries are local prerequisites and are ignored
by Git; they are not supplied by a fresh checkout.

Useful local checks include:

```powershell
npm run build:ui
npm run lint
npx tsc --noEmit -p tsconfig.app.json
npx tsc --noEmit -p tsconfig.node.json
node --test tests/*.cjs
```

Projects support the current `.clipforge` format and legacy `.llc` files. Project
sidecars are saved beside permanent source media; temporary imports remain
temporary until explicitly saved as a permanent project.

Export supports quality-based and target-size encoding. Quality-based file size
is content-dependent, and target-size results are approximate, especially with
single-pass hardware encoders. Fast copy export avoids re-encoding but is
limited by keyframe boundaries and may not produce frame-exact cuts; use exact
export when precise boundaries are required. Remuxing changes the container
without re-encoding when the source streams are compatible.

On Windows, packaged-app checks should be performed with the bundled binaries
available and without relying on FFmpeg being installed on `PATH`.

## Disclaimer

This is an independent project for **personal use**. It is not affiliated with LosslessCut. If you build on this code, keep attribution and respect the license (non-commercial—see `LICENSE`).

## License

See [LICENSE](LICENSE) (PolyForm Noncommercial 1.0.0—free use and modification, **no commercial use**, standard no-warranty terms).
