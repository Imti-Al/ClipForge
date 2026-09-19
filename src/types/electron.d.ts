export type IpcResult<T> = { success: true; data: T } | { success: false; error: string; code: string };

export type ProjectDocument = Partial<ProjectData>;

export interface ElectronAPI {
  closeWindow: (approved: boolean) => Promise<IpcResult<void>>;
  onCloseRequested: (callback: () => void) => () => void;
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
  beginImport: (id: string, name: string, size: number) => Promise<IpcResult<{ chunkBytes: number }>>;
  writeImportChunk: (id: string, offset: number, bytes: ArrayBuffer) => Promise<IpcResult<void>>;
  finishImport: (id: string) => Promise<IpcResult<{ tempPath: string; isTemp: true }>>;
  abortImport: (id: string) => Promise<IpcResult<boolean>>;
  cancelMediaJob: (jobId: string) => Promise<IpcResult<boolean>>;
  isTempImport: (srcPath: string) => Promise<IpcResult<boolean>>;
  moveFile: (src: string, dst: string) => Promise<IpcResult<{ dst: string }>>;
  
  // Export operations
  getExportEstimate: (options: Pick<ExportOptions, 'inputPath' | 'duration' | 'targetSize' | 'copyAudio' | 'useGPU'>) => Promise<IpcResult<ExportEstimate>>;
  getEncoderCapabilities: () => Promise<IpcResult<{ nvenc: boolean; reason: string }>>;
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
  jobId: string;
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

export interface ExportEstimate {
  requestedBytes: number;
  expectedBytes: number;
  videoBitrate: number;
  audioBitrate: number;
  muxBytes: number;
  safetyBytes: number;
  approximate: boolean;
}

export interface ExportProgress {
  jobId: string;
  progress: number;
  currentTime: number;
  speed: number;
  etaSeconds?: number;
  pass?: number;
  passes?: number;
}

export interface RemuxOptions {
  jobId: string;
  inputPath: string;
  outputPath: string;
  duration?: number;
}

export interface RemuxProgress {
  jobId: string;
  inputPath: string;
  currentTime: number;
  speed: number;
  progress?: number;
  etaSeconds?: number;
  pass?: number;
  passes?: number;
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
