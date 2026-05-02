# FFmpeg Binaries

This directory should contain the FFmpeg executables for different platforms:

## Directory Structure
```
ffmpeg/
├── win32/
│   ├── ffmpeg.exe
│   ├── ffprobe.exe
│   └── ffplay.exe
├── darwin/
│   ├── ffmpeg
│   ├── ffprobe
│   └── ffplay
└── linux/
    ├── ffmpeg
    ├── ffprobe
    └── ffplay
```

## How to Obtain FFmpeg Binaries

### Windows
1. Download from: https://www.gyan.dev/ffmpeg/builds/
2. Extract the executables from the `bin` folder
3. Place them in `ffmpeg/win32/`

### macOS
1. Download from: https://evermeet.cx/ffmpeg/
2. Or use Homebrew: `brew install ffmpeg`
3. Copy binaries to `ffmpeg/darwin/`

### Linux
1. Download static builds from: https://johnvansickle.com/ffmpeg/
2. Or install via package manager: `sudo apt install ffmpeg`
3. Copy binaries to `ffmpeg/linux/`

## Important Notes

- Make sure the binaries have execute permissions on macOS/Linux
- The main.js file automatically detects the platform and uses the correct binaries
- These binaries will be bundled with your Electron app during build
- For distribution, ensure you comply with FFmpeg's licensing requirements

## Testing

You can test if the binaries work by running them directly:
```bash
# Windows
./ffmpeg/win32/ffmpeg.exe -version

# macOS/Linux
./ffmpeg/darwin/ffmpeg -version
./ffmpeg/linux/ffmpeg -version
```