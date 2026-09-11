# P0 Windows packaging smoke test

Date: 2026-09-10. No P1 work was performed.

## Build results

The intended production command is `npm run build` (`vite build && electron-builder`).
On this Windows x64 host it targets a per-user, one-click NSIS installer, using
Electron 37.3.1 and the `build` configuration in package.json. Default output is
`dist-electron/ClipForge Setup 0.0.0.exe` and `dist-electron/win-unpacked/ClipForge.exe`.

The unmodified command failed on a locked executable/archive in `dist-electron`.
An output-directory-only override got further, but Windows denied creation of
symbolic links while unpacking electron-builder's winCodeSign tooling. Neither
Windows permissions nor security settings were changed.

This smoke-only command succeeded (exit 0):

```powershell
npm run build -- --config.directories.output=C:/Users/imti/AppData/Local/Temp/ClipForge-P0-20260910-verified --config.win.signAndEditExecutable=false
```

This override is NOT saved in package.json. It skips executable signing/resource
editing; this is an unsigned smoke artifact, not a validated release installer.
The installer was produced but NOT installed.

- Installer: `C:/Users/imti/AppData/Local/Temp/ClipForge-P0-20260910-verified/ClipForge Setup 0.0.0.exe`
- App: `C:/Users/imti/AppData/Local/Temp/ClipForge-P0-20260910-verified/win-unpacked/ClipForge.exe`
- Test media and original encode outputs: `C:/Users/imti/AppData/Local/Temp/ClipForge-P0-20260910/smoke-media/`
- Runtime logs: `runtime.stdout.log` and `runtime.stderr.log` in each smoke output directory.

## Verified, not mocked

- Packaged file-URL startup, rendered Vite UI/CSS, and exposed preload API.
- Rebuilt startup with inherited `VITE_DEV=1` still uses local packaged HTML.
- Bundled binaries are in `resources/ffmpeg/win32/`; both execute with PATH
  restricted to Windows System32. The packaged app probed/encoded with that PATH.
- Native File > Open Video, preview rendering, four-second ffprobe metadata,
  and automatic sidecar creation for the generated H.264/AAC source.
- Real packaged preload/IPC CPU MP4, CPU MKV, NVIDIA NVENC MP4, and MKV-to-MP4
  remux. Hardware: RTX 5080. Output probing confirmed H.264/AAC streams and about
  one second of duration. These encode tests called the actual IPC API, not the dialogs.
- Both export and remux rejected existing outputs with OUTPUT_EXISTS.
- On the rebuilt artifact, a DOM drop event containing a disk-backed File went
  through the real getPathForFile/drop handler, metadata, and preview flow. This
  was not an OS Explorer mouse-drag test.
- Adding a segment and calling window.close 50 ms later (before the 300 ms
  autosave timer) saved the second segment and exited the process. This used the
  real renderer and filesystem, with no substituted persistence implementation.
- The first interactive editor also exited using its native title-bar close.
- Actual ASAR inspection verified JS/CSS payloads, current main/preload equality,
  and configured resource existence. App source has no machine-specific runtime
  paths; the remaining localhost URL is guarded to unpackaged development only.

## Changes in this pass

- Guard development startup with `!app.isPackaged`.
- Remove nonexistent custom icon references. Builder already fell back to the
  default Electron icon; no replacement artwork was introduced.
- Ignore generated dist-electron artifacts in Git.
- Add startup-guard and packaging checks. To include actual artifact checks:

```powershell
$env:CLIPFORGE_PACKAGE_DIR='C:/Users/imti/AppData/Local/Temp/ClipForge-P0-20260910-verified/win-unpacked'
node --test tests/*.cjs
```

Without this variable, the two artifact-dependent checks explicitly skip.

## Remaining manual Windows checks

1. Install the smoke installer under a normal user account; launch its shortcut
   with no FFmpeg installation/PATH entry. Verify UI, preview, and metadata.
2. Drag a normal video from Explorer into ClipForge. Confirm no temporary-import
   banner and that its sidecar references the original file.
3. Use the actual export dialogs for a short CPU and NVENC encode, then the remux
   dialog for an MKV. Repeat an existing output name; check the visible error and
   that the old output remains unchanged.
4. Change a segment and immediately click the window X. Reopen its project and
   confirm the latest segment, bounds, and active selection survived.
5. Confirm permanent-source Save Project As retains the original media path;
   exercise temporary import Save As and a failed save using disposable media.

The default production build remains unverified until its file-lock/tooling
privilege issues are resolved in the local build environment. FFmpeg binaries
are local ignored prerequisites, not supplied by a fresh Git checkout. No
macOS/Linux build, installer upgrade/uninstall, or clean-machine installation was
tested. Missing package description/author and stale Browserslist data remain
warnings, outside this P0 pass. Artifacts above are in a temporary directory.
