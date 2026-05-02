# ClipForge

A personal desktop app inspired by [LosslessCut](https://github.com/mifi/lossless-cut)—same general idea (open a video, set in/out, export, keep small project files), but **not** focused on lossless workflows. It’s built for how I like to work, with extra features I wanted.

**Stack:** Electron + Vite + React + TypeScript, FFmpeg for probe/export/remux.

**Status:** Early / under active development. Expect rough edges and changing behavior.

## What it does (today)

- Open videos (file dialog or drag-and-drop)
- Timeline with playhead and in/out trimming
- Multiple segments, project sidecars (`.clipforge`), autosave
- Export (encode) and batch-style remux helpers where applicable

## Disclaimer

This is an independent project for **personal use**. It is not affiliated with LosslessCut. If you build on this code, keep attribution and respect the license (non-commercial—see `LICENSE`).

## License

See [LICENSE](LICENSE) (PolyForm Noncommercial 1.0.0—free use and modification, **no commercial use**, standard no-warranty terms).
