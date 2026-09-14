import React, { useState, useEffect, useCallback } from 'react';
import MenuBar from './MenuBar';
import VideoPreview from './VideoPreview';
import Timeline from './Timeline';
import Sidebar from './Sidebar';
import { X } from 'lucide-react';
import type { VideoInfo, ProjectData, ProjectDocument, EncoderPrefs } from '../types/electron';
import { unwrapIpc } from '../utils/ipc';

interface MainEditorProps {
  isModalOpen?: boolean;
  onOpenExport: () => void;
  onOpenRemux: () => void;
  onVideoStateChange: (src: string, duration: number, inTime: number, outTime: number) => void;
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

interface SaveSnapshot {
  path: string;
  signature: string;
  data: ProjectData;
  session: number;
  temporary: boolean;
}

const DEFAULT_SEGMENT_ID = 'segment-1';

const createProjectIdentity = (project?: Partial<ProjectData>) => ({
  version: project?.version || '1.0.0',
  createdAt: project?.createdAt || new Date().toISOString()
});

const MainEditor: React.FC<MainEditorProps> = ({
  isModalOpen = false,
  onOpenExport,
  onOpenRemux,
  onVideoStateChange
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [inTime, setInTime] = useState(0);
  const [outTime, setOutTime] = useState(0);
  const [duration, setDuration] = useState(0);
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
    { id: DEFAULT_SEGMENT_ID, start: 0, end: 0, name: 'Main segment' }
  ]);
  const [activeSegmentId, setActiveSegmentId] = useState<string>(DEFAULT_SEGMENT_ID);
  const [deleteProjectOnExit, setDeleteProjectOnExit] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [projectError, setProjectError] = useState('');
  const [saveRevision, setSaveRevision] = useState(0);
  const [isTempImport, setIsTempImport] = useState(false);
  const [showSaveBanner, setShowSaveBanner] = useState(false);
  const [isSaveBannerDismissed, setIsSaveBannerDismissed] = useState(false);

  // Sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320); // Default width in pixels

  /* ---- Guard so <video>.onloadedmetadata doesn't overwrite restored state ---- */
  const suppressNextMetadataInit = React.useRef(false);
  const lastSavedSignatureRef = React.useRef<string>('');
  const sessionRef = React.useRef(0);
  const latestSave = React.useRef<SaveSnapshot | null>(null);
  const autosaveTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const pendingSaves = React.useRef(new Set<Promise<boolean>>());
  const transitionRef = React.useRef(false);
  const allowClose = React.useRef(false);

  const buildSignature = useCallback((sigIn: number, sigOut: number, sigPrefs: EncoderPrefs, sigSegments = segments, sigActiveId = activeSegmentId) => {
    // Intentionally excludes playhead/currentTime to avoid autosaving constantly during playback.
    return JSON.stringify({
      inTime: Number(sigIn),
      outTime: Number(sigOut),
      encoderPrefs: sigPrefs,
      segments: sigSegments,
      activeSegmentId: sigActiveId
    });
  }, [activeSegmentId, segments]);

  const resetEditorState = useCallback(() => {
    sessionRef.current++;
    latestSave.current = null;
    clearTimeout(autosaveTimer.current);
    setProjectError('');
    setIsPlaying(false);
    setCurrentTime(0);
    setInTime(0);
    setOutTime(0);
    setDuration(0);
    setVideoSrc('');
    setVideoInfo(null);
    setIsLoadingVideo(true);
    setCurrentVideoPath('');
    setCurrentProjectPath('');
    setProjectIdentity(createProjectIdentity());
    setEncoderPrefs(DEFAULT_ENCODER_PREFS);
    setSegments([{ id: DEFAULT_SEGMENT_ID, start: 0, end: 0, name: 'Main segment' }]);
    setActiveSegmentId(DEFAULT_SEGMENT_ID);
    setDeleteProjectOnExit(false);
    setHasUnsavedChanges(false);
    setIsInitialized(false);
    setIsTempImport(false);
    setShowSaveBanner(false);
    setIsSaveBannerDismissed(false);
    lastSavedSignatureRef.current = '';
  }, []);

  const applyProjectData = useCallback((project: ProjectDocument, info: VideoInfo, projectPath: string) => {
    const bound = (value: number | undefined, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(info.duration, value)) : fallback;
    const ids = new Set<string>();
    const normalized = (Array.isArray(project.segments) ? project.segments : []).filter(s => s && typeof s === 'object').map((segment, index) => {
      let id = typeof segment.id === 'string' && segment.id && !ids.has(segment.id) ? segment.id : `restored-${index}`;
      while (ids.has(id)) id += '-copy';
      ids.add(id);
      const start = bound(segment.start, 0);
      return { ...segment, id, start, end: Math.max(start, bound(segment.end, info.duration)) };
    });
    const firstSegment = normalized[0];
    setProjectIdentity(createProjectIdentity(project));
    const active = normalized.find(s => s.id === project.activeSegmentId) || firstSegment;
    const nextIn = bound(project.selection?.inTime, active?.start ?? 0);
    const nextOut = Math.max(nextIn, bound(project.selection?.outTime, active?.end ?? info.duration));
    const nextPrefs = project.encoderPrefs || DEFAULT_ENCODER_PREFS;
    const nextSegments = (normalized.length ? normalized : [{
      id: DEFAULT_SEGMENT_ID,
      start: nextIn,
      end: nextOut,
      name: 'Main segment'
    }]);
    const nextActiveId = active?.id || nextSegments[0].id;
    const reconciled = nextSegments.map(s => s.id === nextActiveId ? { ...s, start: nextIn, end: nextOut } : s);
    setInTime(nextIn);
    setOutTime(nextOut);
    setCurrentTime(bound(project.playhead, 0));
    setEncoderPrefs(nextPrefs);
    setSegments(reconciled);
    setActiveSegmentId(nextActiveId);
    setCurrentProjectPath(projectPath);
    suppressNextMetadataInit.current = true;
    lastSavedSignatureRef.current = buildSignature(nextIn, nextOut, nextPrefs, reconciled, nextActiveId);
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

  const currentSignature = buildSignature(inTime, outTime, encoderPrefs);
  if (isInitialized && currentVideoPath) {
    latestSave.current = {
      path: currentProjectPath, data: createProjectData(), signature: currentSignature,
      session: sessionRef.current, temporary: isTempImport
    };
  }

  const persistProject = useCallback((projectPath?: string): Promise<boolean> => {
    clearTimeout(autosaveTimer.current);
    const snapshot = latestSave.current;
    if (!snapshot || snapshot.temporary) return Promise.resolve(true);
    const destination = projectPath || snapshot.path;
    if (!destination) return Promise.resolve(false);
    const task = (async () => {
      try {
        const result = await window.electronAPI.projectSaveFile(destination, snapshot.data);
        if (!result.success) throw new Error(result.error || 'Project save failed.');
        const latest = latestSave.current;
        if (latest && latest.session === snapshot.session && latest.path === snapshot.path) {
          if (destination !== snapshot.path) {
            latestSave.current = { ...latest, path: destination };
            setCurrentProjectPath(destination);
          }
          // Track what reached disk, even if the user edited or reverted meanwhile.
          lastSavedSignatureRef.current = snapshot.signature;
          setHasUnsavedChanges(latest.signature !== snapshot.signature);
          setSaveRevision(revision => revision + 1);
          setProjectError('');
        }
        return true;
      } catch (error) {
        if (snapshot.session === sessionRef.current) {
          setProjectError(error instanceof Error ? error.message : String(error));
          setHasUnsavedChanges(true);
        }
        return false;
      }
    })();
    pendingSaves.current.add(task);
    void task.then(() => pendingSaves.current.delete(task));
    return task;
  }, []);

  const flushProject = useCallback(async () => {
    clearTimeout(autosaveTimer.current);
    while (true) {
      await Promise.all([...pendingSaves.current]);
      const snapshot = latestSave.current;
      if (!snapshot || !snapshot.path || snapshot.temporary || snapshot.signature === lastSavedSignatureRef.current) return true;
      if (!await persistProject()) return false;
    }
  }, [persistProject]);

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

    const nextOut = Math.max(nextIn, clampTime(outTime));
    setInTime(nextIn);
    setOutTime(nextOut);
    setActiveSegmentRange(nextIn, nextOut);
  }, [activeSegmentId, clampTime, duration, outTime, segments, setActiveSegmentRange]);

  const setOutForActive = useCallback((nextOutRaw: number) => {
    if (!segments.some(s => s.id === activeSegmentId)) return;
    const nextOut = Math.max(inTime, clampTime(nextOutRaw));
    setOutTime(nextOut);
    setActiveSegmentRange(inTime, nextOut);
  }, [activeSegmentId, clampTime, inTime, segments, setActiveSegmentRange]);

  useEffect(() => {
    if (!isInitialized || isTempImport || !currentProjectPath || !currentVideoPath) return;
    if (currentSignature === lastSavedSignatureRef.current) return;
    setHasUnsavedChanges(true);
    if (!transitionRef.current) {
      autosaveTimer.current = setTimeout(() => { void persistProject(); }, 300);
    }
    return () => clearTimeout(autosaveTimer.current);
  }, [currentSignature, currentProjectPath, currentVideoPath, isInitialized, isTempImport, persistProject, saveRevision]);

  useEffect(() => {
    const beforeClose = (event: BeforeUnloadEvent) => {
      if (allowClose.current) return;
      event.preventDefault();
      event.returnValue = '';
      if (transitionRef.current) return;
      transitionRef.current = true;
      void flushProject().then(saved => {
        transitionRef.current = false;
        if (saved) {
          allowClose.current = true;
          window.close();
        }
      });
    };
    window.addEventListener('beforeunload', beforeClose);
    return () => window.removeEventListener('beforeunload', beforeClose);
  }, [flushProject]);

  /* ---------------- Delete-on-exit sync ---------------- */
  useEffect(() => {
    if (window.electronAPI && currentProjectPath && !isTempImport) {
      void window.electronAPI.projectSetDeleteOnExit(currentProjectPath, deleteProjectOnExit)
        .then(unwrapIpc).catch(error => setProjectError(String(error)));
    }
  }, [currentProjectPath, deleteProjectOnExit, isTempImport]);

  /* ---------------- Open .llc ---------------- */
  const loadProject = async (projectPath: string) => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.projectOpenSidecar(projectPath);
      if (!result.success) throw new Error(result.error);
      if (result.data?.sourceVideo?.path) {
        await loadFromPath(result.data.sourceVideo.path, {
          projectData: result.data,
          projectPath
        });
      } else {
        throw new Error('Project does not contain a source video path.');
      }
    } catch (error) {
      console.error('Load project error:', error);
      setProjectError(error instanceof Error ? error.message : String(error));
    }
  };

  /* ---------------- Unified "open video by path" ---------------- */
  const loadFromPath = async (
    filePath: string,
    options?: { projectData?: ProjectDocument; projectPath?: string }
  ) => {
    if (!window.electronAPI) return;

    if (transitionRef.current) return;
    transitionRef.current = true;
    if (!await flushProject()) { transitionRef.current = false; return; }
    resetEditorState();

    try {
      // Check if temp import
      const isTemp = unwrapIpc(await window.electronAPI.isTempImport(filePath));
      setIsTempImport(isTemp);

      // Get video info with ffprobe
      const info = unwrapIpc(await window.electronAPI.getVideoInfo(filePath));
      if (!Number.isFinite(info.duration) || info.duration <= 0) throw new Error('Could not determine a valid video duration.');
      setSegments([{ id: DEFAULT_SEGMENT_ID, start: 0, end: info.duration, name: 'Main segment' }]);
      setVideoInfo(info);
      setDuration(info.duration);
      setInTime(0);
      setOutTime(info.duration);
      setCurrentTime(0);
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
          const projectPath = unwrapIpc(await window.electronAPI.projectDefaultPath(filePath));
          const exists = unwrapIpc(await window.electronAPI.projectExists(projectPath));

          if (exists) {
            const open = await window.electronAPI.projectOpenSidecar(projectPath);
            if (open.success) {
              applyProjectData(open.data, info, projectPath);
            } else {
              throw new Error(open.error || 'Project could not be read; it has not been overwritten.');
            }
          } else {
            setProjectIdentity(createProjectIdentity());
            setCurrentProjectPath(projectPath);
          }
        }
      }
      setVideoSrc(`safe-file:${filePath}`);
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : String(error));
      console.error('Failed to load video:', error);
    } finally {
      transitionRef.current = false;
      setIsLoadingVideo(false);
      setIsInitialized(true);
    }
  };

  /* ---------------- Save helpers ---------------- */
  const saveProject = useCallback(async (projectPath?: string) => {
    await persistProject(projectPath);
  }, [persistProject]);

  const handleSaveProjectAs = useCallback(async () => {
    if (!window.electronAPI) return;
    if (!currentVideoPath || transitionRef.current) return;
    transitionRef.current = true;
    clearTimeout(autosaveTimer.current);
    let failed = false;
    try {
    await Promise.all([...pendingSaves.current]);
    if (isTempImport) {
      // Temporary file: Save Video & Project
      const dstVideoPath = unwrapIpc(await window.electronAPI.showSaveVideoDialogForSource(currentVideoPath));
      if (dstVideoPath) {
        try {
          setProjectError('');
          const projectPath = unwrapIpc(await window.electronAPI.projectDefaultPath(dstVideoPath));
          const data = latestSave.current?.data || createProjectData();
          const snapshot = latestSave.current;
          const moved = await window.electronAPI.moveFile(currentVideoPath, dstVideoPath);
          if (!moved.success) throw new Error(moved.error || 'Could not save the temporary video.');
          const permanentPath = moved.data.dst || dstVideoPath;
          setIsTempImport(false);
          setCurrentVideoPath(permanentPath);
          setCurrentProjectPath(projectPath);
          setShowSaveBanner(false);
          setHasUnsavedChanges(true);
          suppressNextMetadataInit.current = true;
          setVideoSrc(`safe-file:${permanentPath}`);
          const latest = latestSave.current;
          if (latest) latestSave.current = { ...latest, path: projectPath, temporary: false, data: { ...latest.data, sourceVideo: { ...latest.data.sourceVideo, path: permanentPath } } };
          const result = await window.electronAPI.projectSaveSidecar(permanentPath, {
            ...data, sourceVideo: { ...data.sourceVideo, path: permanentPath }
          });
          if (result.success) {
            setCurrentProjectPath(result.data.path || projectPath);
            if (snapshot) {
              lastSavedSignatureRef.current = snapshot.signature;
              setHasUnsavedChanges(latestSave.current?.signature !== snapshot.signature);
            }
            console.log('Video and project saved:', dstVideoPath, result.data.path);
          } else {
            throw new Error(`Video saved, but project save failed: ${result.error || 'Unknown error'}. Use Save Project to retry.`);
          }
        } catch (error) {
          failed = true;
          console.error('Failed to save video and project:', error);
          setProjectError(error instanceof Error ? error.message : String(error));
        }
      }
    } else {
      // Permanent file: choose a project file location
      const suggested = currentProjectPath || 'project.clipforge';
      const projectPath = unwrapIpc(await window.electronAPI.showSaveProjectDialog(suggested));
      if (projectPath) {
        failed = !await persistProject(projectPath);
      }
    }
    } catch (error) {
      failed = true;
      setProjectError(error instanceof Error ? error.message : String(error));
    } finally {
      transitionRef.current = false;
      const latest = latestSave.current;
      if (!failed && latest && !latest.temporary && latest.signature !== lastSavedSignatureRef.current) {
        autosaveTimer.current = setTimeout(() => { void persistProject(); }, 300);
      }
    }
  }, [createProjectData, currentProjectPath, currentVideoPath, isTempImport, persistProject]);

  /* ---------------- Menu actions ---------------- */
  const handleSaveProject = useCallback(() => {
    if (isTempImport) handleSaveProjectAs();
    else if (currentProjectPath) saveProject();
    else handleSaveProjectAs();
  }, [currentProjectPath, handleSaveProjectAs, isTempImport, saveProject]);

  const handleOpenProject = async () => {
    if (!window.electronAPI) return;
    try {
      const projectPath = unwrapIpc(await window.electronAPI.showOpenProjectDialog());
      if (projectPath) await loadProject(projectPath);
    } catch (error) { setProjectError(error instanceof Error ? error.message : String(error)); }
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
    if (segments.length <= 1) return;
    const next = segments.filter(s => s.id !== id);
    setSegments(next);
    if (id === activeSegmentId) {
      setActiveSegmentId(next[0].id);
      setInTime(next[0].start);
      setOutTime(next[0].end);
    }
  }, [activeSegmentId, segments]);

  /* ---------------- Parent sync ---------------- */
  useEffect(() => {
    onVideoStateChange(videoSrc, duration, inTime, outTime);
  }, [videoSrc, duration, inTime, outTime, onVideoStateChange]);

  /* ---------------- Player callbacks ---------------- */
  const formatTime = useCallback((seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }, []);

  const handlePlayPause = () => setIsPlaying(!isPlaying);

  const handleFrameStep = useCallback((direction: 'forward' | 'backward') => {
    setIsPlaying(false);
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
      if (isModalOpen || (e.target instanceof HTMLElement && e.target.closest('select, summary, [contenteditable="true"]'))) return;
      if (e.target instanceof HTMLElement && e.target.closest('button') && ['Space', 'Enter'].includes(e.code)) return;
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
  }, [currentTime, handleFrameStep, handleSaveProject, handleSeek, setInForActive, setOutForActive, isModalOpen]);

  const handleTimeUpdate = (time: number) => setCurrentTime(time);

  const handleLoadedMetadata = () => {
    // Probed duration and restored ranges are authoritative; browser metadata must not reset them.
    suppressNextMetadataInit.current = false;
  };

  /* ---------------- Open video via dialog ---------------- */
  const handleLoadVideo = async () => {
    if (!window.electronAPI) return;
    try {
      const filePath = unwrapIpc(await window.electronAPI.openVideoDialog());
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
          p = res.data.tempPath;
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

      <div className="workspace-status">
        <span className="source-name" title={currentVideoPath}>{currentVideoPath ? currentVideoPath.split(/[/\\]/).pop() : 'No source selected'}</span>
        <span className="save-status" title={currentProjectPath || undefined}>{isLoadingVideo ? 'Reading source...' : !videoSrc ? 'Local files. No uploads.' : hasUnsavedChanges ? 'Unsaved changes' : currentProjectPath ? 'Project saved' : 'Ready'}</span>
      </div>
      {projectError && <div role="alert" className="notice error-notice">{projectError}</div>}
      {showSaveBanner && !isSaveBannerDismissed && <div className="notice">
        <span>Temporary video. Save a permanent copy to enable autosave.</span>
        <button className="quiet-button" onClick={handleSaveProjectAs}>Save Video &amp; Project...</button>
        <button className="icon-button" onClick={() => setIsSaveBannerDismissed(true)} aria-label="Dismiss temporary video notice"><X size={15} /></button>
      </div>}
      <div className="editor-workspace">
        <div className="preview-region">
          <VideoPreview
            isLoading={isLoadingVideo}
            onOpen={handleLoadVideo}
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

      <div className="timeline-region">
        <Timeline
          segments={videoSrc ? segments : []}
          activeSegmentId={activeSegmentId}
          onSelectSegment={handleSelectSegment}
          onAddSegment={handleAddSegment}
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
          onExport={() => { setIsPlaying(false); onOpenExport(); }}
          formatTime={formatTime}
        />
      </div>

    </div>
  );
};

export default MainEditor;
