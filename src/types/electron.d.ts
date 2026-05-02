export interface ElectronAPI {
  // File operations
  openVideoDialog: () => Promise<string | null>;
  showOpenProjectDialog: () => Promise<string | null>;
  showSaveProjectDialog: (defaultPath?: string) => Promise<string | null>;
  showSaveVideoDialogForSource: (srcPath: string) => Promise<string | null>;
  selectOutputDirectory: () => Promise<string | null>;
  selectMkvFiles: () => Promise<string[]>;
  showSaveVideoDialog: (defaultPath?: string) => Promise<string | null>;
  getPathForFile: (file: File) => string | null;

  // Video information
  getVideoInfo: (videoPath: string) => Promise<VideoInfo>;
  
  // Import operations (updated to reflect success/error)
  importBlob: (bytes: ArrayBuffer, name: string) => Promise<
    | { success: true; tempPath: string; isTemp: true }
    | { success: false; error: string }
  >;
  isTempImport: (srcPath: string) => Promise<boolean>;
  moveFile: (src: string, dst: string) => Promise<{ success: boolean; dst?: string; error?: string }>;
  
  // Export operations
  exportVideo: (options: ExportOptions) => Promise<{ success: boolean; outputPath: string }>;
  onExportProgress: (callback: (data: ExportProgress) => void) => () => void;
  removeExportProgressListener: () => void;
  
  // Remux operations
  remuxVideo: (options: RemuxOptions) => Promise<{ success: boolean; outputPath: string }>;
  onRemuxProgress: (callback: (data: RemuxProgress) => void) => () => void;
  removeRemuxProgressListener: () => void;
  
  // Platform info
  platform: string;
  
  // Project file operations
  projectDefaultPath: (srcPath: string) => Promise<string>;
  projectSaveSidecar: (srcPath: string, projectData: ProjectData) => Promise<{ success: boolean; path?: string; error?: string }>;
  projectSaveFile: (projectPath: string, projectData: ProjectData) => Promise<{ success: boolean; path?: string; error?: string }>;
  projectOpenSidecar: (projectPath: string) => Promise<{ success: boolean; data?: ProjectData; error?: string }>;
  projectExists: (projectPath: string) => Promise<boolean>;
  projectSetDeleteOnExit: (projectPath: string, enabled: boolean) => Promise<boolean>;
}

export interface VideoInfo {
  duration: number;
  size: number;
  bitrate: number;
  video: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    pixelFormat: string;
  } | null;
  audio: {
    codec: string;
    sampleRate: number;
    channels: number;
    bitrate: number;
  } | null;
}

export interface ExportOptions {
  inputPath: string;
  outputPath: string;
  startTime: number;
  duration: number;
  containerFormat: string;
  mode: 'crf' | 'target';
  crfValue: number;
  targetSize: number;
  preset: string;
  useGPU: boolean;
  copyAudio: boolean;
}

export interface ExportProgress {
  progress: number;
  currentTime: number;
  speed: number;
}

export interface RemuxOptions {
  inputPath: string;
  outputPath: string;
  duration?: number;
}

export interface RemuxProgress {
  inputPath: string;
  currentTime: number;
  speed: number;
  progress?: number;
}

export interface ProjectSegment {
  id: string;
  start: number;
  end: number;
  name?: string;
}

export interface EncoderPrefs {
  format: string;
  mode: 'crf' | 'targetSize';
  crfValue: number;
  preset: string;
  targetSize: number;
  useGpu: boolean;
  copyAudio: boolean;
}

export interface ProjectData {
  version: string;
  createdAt: string;
  lastModified: string;
  sourceVideo: {
    path: string;
    duration: number;
    info?: VideoInfo;
  };
  segments: ProjectSegment[];
  selection: {
    inTime: number;
    outTime: number;
  };
  playhead: number;
  encoderPrefs: EncoderPrefs;
  activeSegmentId?: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
