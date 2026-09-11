export type IpcResult<T> = { success: true; data: T } | { success: false; error: string; code: string };

export type ProjectDocument = Partial<ProjectData>;

export interface ElectronAPI {
  // File operations
  openVideoDialog: () => Promise<IpcResult<string | null>>;
  showOpenProjectDialog: () => Promise<IpcResult<string | null>>;
  showSaveProjectDialog: (defaultPath?: string) => Promise<IpcResult<string | null>>;
  showSaveVideoDialogForSource: (srcPath: string) => Promise<IpcResult<string | null>>;
  selectMkvFiles: () => Promise<IpcResult<string[]>>;
  showSaveVideoDialog: (defaultPath?: string) => Promise<IpcResult<string | null>>;
  getPathForFile: (file: File) => string | null;

  // Video information
  getVideoInfo: (videoPath: string) => Promise<IpcResult<VideoInfo>>;
  
  // Import operations (updated to reflect success/error)
  importBlob: (bytes: ArrayBuffer | Uint8Array, name: string) => Promise<IpcResult<{ tempPath: string; isTemp: true }>>;
  isTempImport: (srcPath: string) => Promise<IpcResult<boolean>>;
  moveFile: (src: string, dst: string) => Promise<IpcResult<{ dst: string }>>;
  
  // Export operations
  exportVideo: (options: ExportOptions) => Promise<IpcResult<{ outputPath: string }>>;
  onExportProgress: (callback: (data: ExportProgress) => void) => () => void;
  
  // Remux operations
  remuxVideo: (options: RemuxOptions) => Promise<IpcResult<{ outputPath: string }>>;
  onRemuxProgress: (callback: (data: RemuxProgress) => void) => () => void;
  
  // Platform info
  platform: string;
  
  // Project file operations
  projectDefaultPath: (srcPath: string) => Promise<IpcResult<string>>;
  projectSaveSidecar: (srcPath: string, projectData: ProjectData) => Promise<IpcResult<{ path: string }>>;
  projectSaveFile: (projectPath: string, projectData: ProjectData) => Promise<IpcResult<{ path: string }>>;
  projectOpenSidecar: (projectPath: string) => Promise<IpcResult<ProjectDocument>>;
  projectExists: (projectPath: string) => Promise<IpcResult<boolean>>;
  projectSetDeleteOnExit: (projectPath: string, enabled: boolean) => Promise<IpcResult<boolean>>;
}

export interface VideoInfo {
  path: string;
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
