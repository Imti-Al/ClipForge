import React, { useState, useEffect, useCallback } from 'react';
import MenuBar from './MenuBar';
import VideoPreview from './VideoPreview';
import Timeline from './Timeline';
import Sidebar from './Sidebar';
import { X } from 'lucide-react';
import type { VideoInfo, ProjectData, EncoderPrefs } from '../types/electron';

interface MainEditorProps {
  onOpenExport: () => void;
  onOpenRemux: () => void;
  onVideoStateChange: (src: string, duration: number, inTime: number, outTime: number) => void;
}

/* ---------------- Debounce ---------------- */
function useDebounce<T extends (...args: unknown[]) => void>(callback: T, delay: number): T {
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  return React.useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  }, [callback, delay]) as T;
}

/* ---------------- Drag/drop helpers ---------------- */
function toWinPath(p: string) {
  return /^\/[A-Za-z]:\//.test(p) ? p.slice(1) : p;
}

function pickVideoFile(files: FileList | File[]): File | null {
  const arr = Array.from(files as unknown as File[]);
  return arr.find(f => f.type?.startsWith('video/'))
      ?? arr.find(f => /\.(mp4|mkv|mov|webm|m4v|avi)$/i.test(f.name))
      ?? arr[0] ?? null;
}

function pathFromDrop(e: React.DragEvent): string | null {
  // 1) Electron/Chromium file drops typically include a File with a .path property.
  // Prefer that to avoid blob-importing (temp copies).
  const firstFile = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
  if (firstFile?.path) return firstFile.path;
  if (firstFile && window.electronAPI?.getPathForFile) {
    const p = window.electronAPI.getPathForFile(firstFile);
    if (p) return p;
  }

  // 2) Some drops only expose files via items.
  const firstItemFile = e.dataTransfer.items?.length
    ? (Array.from(e.dataTransfer.items)
        .find(it => it.kind === 'file')
        ?.getAsFile() as (File & { path?: string }) | null)
    : null;
  if (firstItemFile?.path) return firstItemFile.path;
  if (firstItemFile && window.electronAPI?.getPathForFile) {
    const p = window.electronAPI.getPathForFile(firstItemFile);
    if (p) return p;
  }

  // 3) URI list (file://)
  const uri = (e.dataTransfer.getData('text/uri-list') || '')
    .split('\n').find(l => l && !l.startsWith('#'));
  if (uri?.startsWith('file:')) return toWinPath(decodeURIComponent(new URL(uri).pathname));
  const textRaw = (e.dataTransfer.getData('text/plain') || '').trim();
  const text = textRaw.replace(/^"+|"+$/g, ''); // strip wrapping quotes
  // Some Windows drags provide a raw path in text/plain.
  if (/^[A-Za-z]:[\\/]/.test(text)) return text;
  // Sometimes text/plain contains multiple lines; pick the first path-like line.
  for (const line of textRaw.split(/\r?\n/).map(l => l.trim()).filter(Boolean)) {
    const cleaned = line.replace(/^"+|"+$/g, '');
    if (/^[A-Za-z]:[\\/]/.test(cleaned)) return cleaned;
    if (cleaned.startsWith('file:')) return toWinPath(decodeURIComponent(new URL(cleaned).pathname));
  }
  if (text.startsWith('file:')) return toWinPath(decodeURIComponent(new URL(text).pathname));
  return null;
}

const DEFAULT_ENCODER_PREFS: EncoderPrefs = {
  format: 'mp4',
  mode: 'crf',
  crfValue: 23,
  preset: 'medium',
  targetSize: 50,
  useGpu: false,
  copyAudio: true
};

const DEFAULT_SEGMENT_ID = 'segment-1';

const createProjectIdentity = (project?: Partial<ProjectData>) => ({
  version: project?.version || '1.0.0',
  createdAt: project?.createdAt || new Date().toISOString()
});

const MainEditor: React.FC<MainEditorProps> = ({
  onOpenExport,
  onOpenRemux,
  onVideoStateChange
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [inTime, setInTime] = useState(0);
  const [outTime, setOutTime] = useState(600);
  const [duration, setDuration] = useState(600);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Project state
  const [currentVideoPath, setCurrentVideoPath] = useState<string>('');
  const [currentProjectPath, setCurrentProjectPath] = useState<string>('');
  const [projectIdentity, setProjectIdentity] = useState(() => createProjectIdentity());
  const [encoderPrefs, setEncoderPrefs] = useState<EncoderPrefs>(DEFAULT_ENCODER_PREFS);
  const [segments, setSegments] = useState<ProjectData['segments']>([
    { id: DEFAULT_SEGMENT_ID, start: 0, end: 600, name: 'Main segment' }
  ]);
  const [activeSegmentId, setActiveSegmentId] = useState<string>(DEFAULT_SEGMENT_ID);
  const [deleteProjectOnExit, setDeleteProjectOnExit] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isTempImport, setIsTempImport] = useState(false);
  const [showSaveBanner, setShowSaveBanner] = useState(false);
  const [isSaveBannerDismissed, setIsSaveBannerDismissed] = useState(false);

  // Sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320); // Default width in pixels

  /* ---- Guard so <video>.onloadedmetadata doesn't overwrite restored state ---- */
  const suppressNextMetadataInit = React.useRef(false);
  const lastSavedSignatureRef = React.useRef<string>('');

  const buildSignature = useCallback((sigIn: number, sigOut: number, sigPrefs: EncoderPrefs) => {
    // Intentionally excludes playhead/currentTime to avoid autosaving constantly during playback.
    return JSON.stringify({
      inTime: Number(sigIn),
      outTime: Number(sigOut),
      encoderPrefs: sigPrefs,
      segments,
      activeSegmentId
    });
  }, [activeSegmentId, segments]);

  const resetEditorState = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setInTime(0);
    setOutTime(600);
    setDuration(600);
    setVideoSrc('');
    setVideoInfo(null);
    setIsLoadingVideo(true);
    setCurrentVideoPath('');
    setCurrentProjectPath('');
    setProjectIdentity(createProjectIdentity());
    setEncoderPrefs(DEFAULT_ENCODER_PREFS);
    setSegments([{ id: DEFAULT_SEGMENT_ID, start: 0, end: 600, name: 'Main segment' }]);
    setActiveSegmentId(DEFAULT_SEGMENT_ID);
    setDeleteProjectOnExit(false);
    setHasUnsavedChanges(false);
    setIsInitialized(false);
    setIsTempImport(false);
    setShowSaveBanner(false);
    setIsSaveBannerDismissed(false);
    lastSavedSignatureRef.current = '';
  }, []);

  const applyProjectData = useCallback((project: ProjectData, info: VideoInfo, projectPath: string) => {
    const firstSegment = project.segments?.[0];
    setProjectIdentity(createProjectIdentity(project));
    const nextIn = project.selection?.inTime ?? firstSegment?.start ?? 0;
    const nextOut = project.selection?.outTime ?? firstSegment?.end ?? info.duration;
    const nextPrefs = project.encoderPrefs || DEFAULT_ENCODER_PREFS;
    const nextSegments = (project.segments?.length ? project.segments : [{
      id: DEFAULT_SEGMENT_ID,
      start: nextIn,
      end: nextOut,
      name: 'Main segment'
    }]);
    const nextActiveId = project.activeSegmentId || nextSegments[0]?.id || DEFAULT_SEGMENT_ID;
    setInTime(nextIn);
    setOutTime(nextOut);
    setCurrentTime(project.playhead ?? 0);
    setEncoderPrefs(nextPrefs);
    setSegments(nextSegments);
    setActiveSegmentId(nextActiveId);
    setCurrentProjectPath(projectPath);
    suppressNextMetadataInit.current = true;
    lastSavedSignatureRef.current = buildSignature(nextIn, nextOut, nextPrefs);
    setHasUnsavedChanges(false);
  }, [buildSignature]);

  /* ---------------- Project JSON ---------------- */
  const createProjectData = useCallback((): ProjectData => ({
    version: projectIdentity.version,
    createdAt: projectIdentity.createdAt,
    lastModified: new Date().toISOString(),
    sourceVideo: {
      path: currentVideoPath,
      duration,
      info: videoInfo || undefined
    },
    segments,
    selection: { inTime, outTime },
    playhead: currentTime,
    encoderPrefs,
    activeSegmentId
  }), [activeSegmentId, currentTime, currentVideoPath, duration, encoderPrefs, inTime, outTime, projectIdentity.createdAt, projectIdentity.version, segments, videoInfo]);

  const persistProject = useCallback(async (projectPath?: string) => {
    if (!window.electronAPI) return { success: false, error: 'Electron API not available' };
    const pathToSave = projectPath || currentProjectPath;
    if (!pathToSave) return { success: false, error: 'Missing project path' };

    const defaultProjectPath = await window.electronAPI.projectDefaultPath(currentVideoPath);
    return pathToSave === defaultProjectPath
      ? window.electronAPI.projectSaveSidecar(currentVideoPath, createProjectData())
      : window.electronAPI.projectSaveFile(pathToSave, createProjectData());
  }, [createProjectData, currentProjectPath, currentVideoPath]);

  /* ---------------- Autosave (debounced) ---------------- */
  const currentSignature = buildSignature(inTime, outTime, encoderPrefs);

  const clampTime = useCallback((t: number) => {
    const x = Number(t);
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(duration || 0, x));
  }, [duration]);

  const setActiveSegmentRange = useCallback((nextIn: number, nextOut: number) => {
    setSegments(prev =>
      prev.map(s => (s.id === activeSegmentId ? { ...s, start: nextIn, end: nextOut } : s))
    );
  }, [activeSegmentId]);

  const setInForActive = useCallback((nextInRaw: number) => {
    const seg = segments.find(s => s.id === activeSegmentId);
    if (!seg) return;

    const nextIn = clampTime(nextInRaw);
    // If In is set after the active segment ends, create a new segment instead of shifting.
    if (nextIn > seg.end) {
      const id = `segment-${Date.now()}`;
      const newSeg = { id, start: nextIn, end: duration || nextIn, name: `Segment ${segments.length + 1}` };
      setSegments(prev => [...prev, newSeg]);
      setActiveSegmentId(id);
      setInTime(nextIn);
      setOutTime(newSeg.end);
      return;
    }

    const minGap = 0.001;
    const boundedOut = Math.max(seg.end, nextIn + minGap);
    setInTime(nextIn);
    // Expand/shrink only the start; keep end unless it would invert.
    if (outTime < nextIn + minGap) setOutTime(boundedOut);
    setActiveSegmentRange(nextIn, Math.max(outTime, nextIn + minGap));
  }, [activeSegmentId, clampTime, duration, outTime, segments, setActiveSegmentRange]);

  const setOutForActive = useCallback((nextOutRaw: number) => {
    const seg = segments.find(s => s.id === activeSegmentId);
    if (!seg) return;
    const minGap = 0.001;
    const nextOut = clampTime(nextOutRaw);
    const boundedOut = Math.max(nextOut, inTime + minGap);
    setOutTime(boundedOut);
    setActiveSegmentRange(inTime, boundedOut);
  }, [activeSegmentId, clampTime, inTime, segments, setActiveSegmentRange]);

  const autosaveNow = useCallback(async () => {
    if (!currentProjectPath || !currentVideoPath || !window.electronAPI || isTempImport) return;
    try {
      const result = await persistProject(currentProjectPath);
      if (result.success) {
        setHasUnsavedChanges(false);
        lastSavedSignatureRef.current = currentSignature;
        console.log('Project autosaved:', result.path);
      } else {
        console.error('Autosave failed:', result.error);
      }
    } catch (error) {
      console.error('Autosave error:', error);
    }
  }, [currentProjectPath, currentSignature, currentVideoPath, isTempImport, persistProject]);

  const debouncedAutosave = useDebounce(autosaveNow, 300);

  useEffect(() => {
    if (
      isInitialized &&
      !isTempImport &&
      currentProjectPath &&
      currentVideoPath &&
      (inTime !== 0 || outTime !== duration)
    ) {
      if (currentSignature !== lastSavedSignatureRef.current) {
        setHasUnsavedChanges(true);
        debouncedAutosave();
      }
    }
  }, [currentSignature, debouncedAutosave, currentProjectPath, currentVideoPath, duration, inTime, isInitialized, isTempImport, outTime]);

  /* ---------------- Delete-on-exit sync ---------------- */
  useEffect(() => {
    if (window.electronAPI && currentProjectPath && !isTempImport) {
      window.electronAPI.projectSetDeleteOnExit(currentProjectPath, deleteProjectOnExit);
    }
  }, [currentProjectPath, deleteProjectOnExit, isTempImport]);

  /* ---------------- Open .llc ---------------- */
  const loadProject = async (projectPath: string) => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.projectOpenSidecar(projectPath);
      if (result.success && result.data?.sourceVideo?.path) {
        await loadFromPath(result.data.sourceVideo.path, {
          projectData: result.data,
          projectPath
        });
      } else {
        console.error('Failed to load project:', result.error);
      }
    } catch (error) {
      console.error('Load project error:', error);
    }
  };

  /* ---------------- Unified "open video by path" ---------------- */
  const loadFromPath = async (
    filePath: string,
    options?: { projectData?: ProjectData; projectPath?: string }
  ) => {
    if (!window.electronAPI) return;

    resetEditorState();

    try {
      // Check if temp import
      const isTemp = await window.electronAPI.isTempImport(filePath);
      setIsTempImport(isTemp);

      // Get video info with ffprobe
      const info = await window.electronAPI.getVideoInfo(filePath);
      setVideoInfo(info);
      setDuration(info.duration);
      setInTime(0);
      setOutTime(info.duration);
      setCurrentTime(0);
      setVideoSrc(`safe-file:${filePath}`);
      setCurrentVideoPath(filePath);

      if (isTemp) {
        // Temporary file: show banner and create default segment
        setProjectIdentity(createProjectIdentity(options?.projectData));
        setShowSaveBanner(true);
      } else {
        const explicitProject = options?.projectData;
        const explicitProjectPath = options?.projectPath;

        if (explicitProject && explicitProjectPath) {
          applyProjectData(explicitProject, info, explicitProjectPath);
        } else {
          // Permanent file: check for existing project
          const projectPath = await window.electronAPI.projectDefaultPath(filePath);
          const exists = await window.electronAPI.projectExists(projectPath);

          if (exists) {
            const open = await window.electronAPI.projectOpenSidecar(projectPath);
            if (open.success && open.data) {
              applyProjectData(open.data, info, projectPath);
            } else {
              setProjectIdentity(createProjectIdentity());
              setCurrentProjectPath(projectPath);
            }
          } else {
            setProjectIdentity(createProjectIdentity());
            setCurrentProjectPath(projectPath);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load video:', error);
    } finally {
      setIsLoadingVideo(false);
      setIsInitialized(true);
    }
  };

  /* ---------------- Save helpers ---------------- */
  const saveProject = useCallback(async (projectPath?: string) => {
    const pathToSave = projectPath || currentProjectPath;
    if (!pathToSave) return;
    try {
      const result = await persistProject(pathToSave);
      if (result.success) {
        setCurrentProjectPath(result.path || pathToSave);
        setHasUnsavedChanges(false);
        lastSavedSignatureRef.current = currentSignature;
        console.log('Project saved:', result.path);
      } else {
        console.error('Save failed:', result.error);
      }
    } catch (error) {
      console.error('Save project error:', error);
    }
  }, [currentProjectPath, currentSignature, persistProject]);

  const handleSaveProjectAs = useCallback(async () => {
    if (!window.electronAPI) return;

    if (isTempImport) {
      // Temporary file: Save Video & Project
      const dstVideoPath = await window.electronAPI.showSaveVideoDialogForSource(currentVideoPath);
      if (dstVideoPath) {
        try {
          await window.electronAPI.moveFile(currentVideoPath, dstVideoPath);
          const result = await window.electronAPI.projectSaveSidecar(dstVideoPath, createProjectData());
          if (result.success) {
            setIsTempImport(false);
            setCurrentVideoPath(dstVideoPath);
            setCurrentProjectPath(result.path || '');
            setShowSaveBanner(false);
            setHasUnsavedChanges(false);
            setVideoSrc(`safe-file:${dstVideoPath}`);
            console.log('Video and project saved:', dstVideoPath, result.path);
          }
        } catch (error) {
          console.error('Failed to save video and project:', error);
        }
      }
    } else {
      // Permanent file: choose a project file location
      const suggested = currentProjectPath || 'project.clipforge';
      const projectPath = await window.electronAPI.showSaveProjectDialog(suggested);
      if (projectPath) {
        await saveProject(projectPath);
      }
    }
  }, [createProjectData, currentProjectPath, currentVideoPath, isTempImport, saveProject]);

  /* ---------------- Menu actions ---------------- */
  const handleSaveProject = useCallback(() => {
    if (isTempImport) handleSaveProjectAs();
    else if (currentProjectPath) saveProject();
    else handleSaveProjectAs();
  }, [currentProjectPath, handleSaveProjectAs, isTempImport, saveProject]);

  const handleOpenProject = async () => {
    if (!window.electronAPI) return;
    const projectPath = await window.electronAPI.showOpenProjectDialog();
    if (projectPath) await loadProject(projectPath);
  };

  const handleToggleDeleteProjectOnExit = () => setDeleteProjectOnExit(!deleteProjectOnExit);

  const handleExit = () => {
    if (window.electronAPI) {
      // In Electron, we can close the window which will trigger app quit
      window.close();
    } else {
      // Fallback for web version
      window.close();
    }
  };

  const handleToggleSidebar = () => setIsSidebarCollapsed(!isSidebarCollapsed);

  const handleAddSegment = useCallback(() => {
    const id = `segment-${Date.now()}`;
    const next = { id, start: inTime, end: outTime, name: `Segment ${segments.length + 1}` };
    setSegments(prev => [...prev, next]);
    setActiveSegmentId(id);
  }, [inTime, outTime, segments.length]);

  const handleSelectSegment = useCallback((id: string) => {
    const seg = segments.find(s => s.id === id);
    if (!seg) return;
    setActiveSegmentId(id);
    setInTime(seg.start);
    setOutTime(seg.end);
  }, [segments]);

  const handleDeleteSegment = useCallback((id: string) => {
    setSegments(prev => {
      if (prev.length <= 1) return prev;
      const next = prev.filter(s => s.id !== id);
      // If we deleted the active one, pick the first remaining segment.
      if (id === activeSegmentId) {
        const first = next[0];
        if (first) {
          setActiveSegmentId(first.id);
          setInTime(first.start);
          setOutTime(first.end);
        }
      }
      return next;
    });
  }, [activeSegmentId]);

  /* ---------------- Parent sync ---------------- */
  useEffect(() => {
    onVideoStateChange(videoSrc, duration, inTime, outTime);
  }, [videoSrc, duration, inTime, outTime, onVideoStateChange]);

  /* ---------------- Player callbacks ---------------- */
  const formatTime = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  const handlePlayPause = () => setIsPlaying(!isPlaying);

  const handleFrameStep = useCallback((direction: 'forward' | 'backward') => {
    const frameTime = 1 / (videoInfo?.video?.fps || 30);
    const newTime = direction === 'forward'
      ? Math.min(duration, currentTime + frameTime)
      : Math.max(0, currentTime - frameTime);
    setCurrentTime(newTime);
  }, [currentTime, duration, videoInfo]);

  const handleSeek = useCallback((direction: 'forward' | 'backward') => {
    const seekTime = 5;
    const newTime = direction === 'forward'
      ? Math.min(duration, currentTime + seekTime)
      : Math.max(0, currentTime - seekTime);
    setCurrentTime(newTime);
  }, [currentTime, duration]);

  /* ---------------- Keyboard shortcuts ---------------- */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveProject();
        return;
      }
      switch (e.code) {
        case 'Space': e.preventDefault(); setIsPlaying(p => !p); break;
        case 'Comma': e.preventDefault(); handleFrameStep('backward'); break;
        case 'Period': e.preventDefault(); handleFrameStep('forward'); break;
        case 'ArrowLeft': e.preventDefault(); handleSeek('backward'); break;
        case 'ArrowRight': e.preventDefault(); handleSeek('forward'); break;
        case 'KeyI': e.preventDefault(); setInForActive(currentTime); break;
        case 'KeyO': e.preventDefault(); setOutForActive(currentTime); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentTime, handleFrameStep, handleSaveProject, handleSeek, setInForActive, setOutForActive]);

  const handleTimeUpdate = (time: number) => setCurrentTime(time);

  const handleLoadedMetadata = (videoDuration: number) => {
    setDuration(videoDuration);
    // Guard: if we just restored a project, do not override its selection/playhead
    if (suppressNextMetadataInit.current) {
      suppressNextMetadataInit.current = false;
      return;
    }
    setOutTime(videoDuration);
    setCurrentTime(0);
  };

  /* ---------------- Open video via dialog ---------------- */
  const handleLoadVideo = async () => {
    if (!window.electronAPI) return;
    try {
      const filePath = await window.electronAPI.openVideoDialog();
      if (filePath) await loadFromPath(filePath);
    } catch (error) {
      console.error('Failed to open video:', error);
    }
  };

  /* ---------------- Drag & Drop ---------------- */
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (!window.electronAPI) return;

    // Try to get file path from drag data
    let p = pathFromDrop(e);

    // If no path but we have files, handle as blob import
    if (!p && e.dataTransfer.files?.length) {
      const f = pickVideoFile(e.dataTransfer.files);
      if (!f) return;
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        const res = await window.electronAPI.importBlob(buf, f.name);
        if (res.success) {
          p = res.tempPath;
        } else {
          console.error('Failed to import blob:', res.error);
          return;
        }
      } catch (error) {
        console.error('Failed to import blob:', error);
        return;
      }
    }
    
    if (p) await loadFromPath(p);
  };

  /* ---------------- Render ---------------- */
  return (
    <div
      className="h-full flex flex-col"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      tabIndex={0}
      style={{ outline: 'none' }}
    >
      <MenuBar
        onOpenRemux={onOpenRemux}
        onLoadVideo={handleLoadVideo}
        onSaveProject={handleSaveProject}
        onSaveProjectAs={handleSaveProjectAs}
        onOpenProject={handleOpenProject}
        deleteProjectOnExit={deleteProjectOnExit}
        onToggleDeleteProjectOnExit={handleToggleDeleteProjectOnExit}
        onExit={handleExit}
        onToggleSidebar={handleToggleSidebar}
        isSidebarCollapsed={isSidebarCollapsed}
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 p-6">
          <VideoPreview
            isPlaying={isPlaying}
            videoSrc={videoSrc}
            currentTime={currentTime}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onPlayPause={handlePlayPause}
          />
        </div>

        {!isSidebarCollapsed && (
          <Sidebar
            videoInfo={videoInfo}
            inTime={inTime}
            outTime={outTime}
            segments={segments}
            activeSegmentId={activeSegmentId}
            onAddSegment={handleAddSegment}
            onSelectSegment={handleSelectSegment}
            onDeleteSegment={handleDeleteSegment}
            formatTime={formatTime}
            isLoadingVideo={isLoadingVideo}
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
          />
        )}
      </div>

      <div className="h-32 relative">
        <Timeline
          currentTime={currentTime}
          inTime={inTime}
          outTime={outTime}
          duration={duration}
          isPlaying={isPlaying}
          fps={videoInfo?.video?.fps}
          onCurrentTimeChange={setCurrentTime}
          onInTimeChange={setInForActive}
          onOutTimeChange={setOutForActive}
          onPlayPause={handlePlayPause}
          onExport={onOpenExport}
          formatTime={formatTime}
        />
      </div>

      {hasUnsavedChanges && (
        <div className="absolute top-16 right-4 bg-yellow-600 text-white px-3 py-1 rounded text-sm">
          Unsaved changes
        </div>
      )}

      {showSaveBanner && !isSaveBannerDismissed && (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-4">
          <span>This video is temporary. Save it to a permanent location to enable autosave.</span>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleSaveProjectAs}
              className="bg-white text-blue-600 px-4 py-1 rounded font-medium hover:bg-gray-100 transition-colors"
            >
              Save Video & Project…
            </button>
            <button
              onClick={() => setIsSaveBannerDismissed(true)}
              className="p-1 hover:bg-blue-700 rounded transition-colors"
              title="Dismiss"
            >
              <X size={16} className="text-white" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MainEditor;
