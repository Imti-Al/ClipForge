import React, { useState } from 'react';
import { unwrapIpc } from '../utils/ipc';
import Dialog from './Dialog';
import { Upload, Trash2, ArrowRight, RefreshCw } from 'lucide-react';
import type { RemuxOptions, RemuxProgress } from '../types/electron';

interface RemuxModalProps {
  onClose: () => void;
}

interface RemuxItem {
  id: string;
  source: string;
  target: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  duration: number;
  error?: string;
}

const RemuxModal: React.FC<RemuxModalProps> = ({ onClose }) => {
  const [items, setItems] = useState<RemuxItem[]>([
    // Start with empty list - users will add files via drag & drop or file selection
  ]);
  const [isDragging, setIsDragging] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [queueError, setQueueError] = useState('');
  const running = React.useRef(false);
  const admitted = React.useRef(new Set<string>());
  const pathKey = (p: string) => {
    const key = p.replace(/\\/g, '/');
    return window.electronAPI?.platform === 'win32' ? key.toLowerCase() : key;
  };

  const enqueue = async (paths: string[]) => {
    const unique = paths.filter(p => {
      const key = pathKey(p);
      if (!/\.mkv$/i.test(p) || admitted.current.has(key)) return false;
      admitted.current.add(key);
      return true;
    });
    const added: RemuxItem[] = [];
    for (const source of unique) {
      let duration = 0;
      try {
        const info = unwrapIpc(await window.electronAPI.getVideoInfo(source));
        duration = Number.isFinite(info.duration) && info.duration > 0 ? info.duration : 0;
      } catch {
        // Keep the file queued even if metadata is unavailable.
      }
      added.push({
        id: pathKey(source), source, target: source.replace(/\.mkv$/i, '.mp4'),
        status: 'pending', progress: 0, duration
      });
    }
    setItems(prev => [...prev, ...added]);
  };

  const addMkvFiles = async () => {
    if (!window.electronAPI) return;
    try {
      await enqueue(unwrapIpc(await window.electronAPI.selectMkvFiles()));
    } catch (error) {
      setQueueError(String(error));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const paths = Array.from(e.dataTransfer.files)
      .map(file => window.electronAPI?.getPathForFile(file))
      .filter((p): p is string => typeof p === 'string' && /\.mkv$/i.test(p));
    if (!paths.length) {
      setQueueError('Drop local MKV files, or use the file picker.');
      return;
    }
    void enqueue(paths).catch(error => setQueueError(String(error)));
  };

  const clearFinished = () => {
    if (running.current) return;
    items.filter(item => item.status === 'completed').forEach(item => admitted.current.delete(item.id));
    setItems(prev => prev.filter(item => item.status !== 'completed'));
  };

  const clearAll = () => {
    if (running.current) return;
    items.forEach(item => admitted.current.delete(item.id));
    setItems([]);
  };

  const startRemux = async () => {
    if (running.current) return;
    if (!window.electronAPI) {
      setQueueError('Remux requires the ClipForge desktop app.');
      return;
    }
    const pending = items.filter(item => item.status === 'pending');
    if (!pending.length) return;
    running.current = true;
    setIsRunning(true);
    setQueueError('');
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = window.electronAPI.onRemuxProgress((data: RemuxProgress) => {
        setItems(prev => prev.map(item => {
          if (item.source !== data.inputPath || item.status !== 'processing') return item;
          const percent = data.progress ?? (item.duration > 0 ? data.currentTime / item.duration * 100 : 0);
          return { ...item, progress: Number.isFinite(percent) ? Math.max(item.progress, Math.min(99, Math.max(0, Math.round(percent)))) : item.progress };
        }));
      });
      for (const item of pending) {
        setItems(prev => prev.map(row => row.id === item.id ? { ...row, status: 'processing' } : row));
        try {
          const options: RemuxOptions = { inputPath: item.source, outputPath: item.target, duration: item.duration };
          const result = await window.electronAPI.remuxVideo(options);
          if (!result.success) throw new Error(result.error);
          setItems(prev => prev.map(row => row.id === item.id ? { ...row, status: 'completed', progress: 100 } : row));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setItems(prev => prev.map(row => row.id === item.id ? { ...row, status: 'error', error: message } : row));
        }
      }
    } catch (error) {
      setQueueError(String(error));
    } finally {
      unsubscribe?.();
      running.current = false;
      setIsRunning(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'state-completed';
      case 'processing': return 'state-processing';
      case 'error': return 'state-error';
      default: return 'muted';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return 'Completed';
      case 'processing': return 'Running';
      case 'error': return 'Failed';
      default: return 'Waiting';
    }
  };

  return <Dialog title="Remux recordings" eyebrow="NEW CONTAINER. SAME QUALITY." busy={isRunning} onClose={onClose}
    footer={<><div className="footer-actions"><button onClick={clearFinished} disabled={isRunning || !items.some(item => item.status === 'completed')} className="quiet-button"><Trash2 size={14} />Clear finished</button><button onClick={clearAll} disabled={isRunning || !items.length} className="quiet-button">Clear all</button></div>
      <button onClick={startRemux} disabled={isRunning || !items.some(item => item.status === 'pending')} className="primary-button"><RefreshCw size={15} />{isRunning ? 'Remuxing...' : 'Remux'}</button></>}>
    <p className="dialog-intro">Repackage MKV recordings as MP4 without re-encoding.<br />Original files stay in place. Outputs are saved beside them.</p>
    {queueError && <p role="alert" className="error-box">{queueError}</p>}
    <div className={`remux-drop ${isDragging ? 'dragging' : ''}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      <Upload size={22} /><div><strong>Drop your MKV recordings here</strong><span>One file or a whole batch</span></div><button className="secondary-button" onClick={addMkvFiles}>Add files</button>
    </div>
    <div className="remux-list-heading"><span>RECORDINGS</span><span>{items.length} {items.length === 1 ? 'file' : 'files'}</span></div>
    <div className="remux-list">
      {!items.length && <p className="remux-empty">Nothing queued yet. Add a recording to get started.</p>}
      {items.map(item => <article key={item.id} className="remux-item">
        <div className="remux-paths"><span title={item.source}>{item.source.split(/[/\\]/).pop()}</span><ArrowRight size={13} /><span title={item.target}>{item.target.split(/[/\\]/).pop()}</span></div>
        <div className="remux-state"><span className={getStatusColor(item.status)}>{getStatusText(item.status)}</span><span className="mono">{item.status === 'processing' ? item.duration > 0 ? `${item.progress}%` : 'Duration unavailable' : item.status === 'completed' ? '100%' : ''}</span></div>
        <progress aria-label={`Remux progress: ${item.source}`} max="100" value={item.progress} />
        {item.error && <details className="remux-error"><summary>Remux failed: view details</summary><pre>{item.error}</pre></details>}
      </article>)}
    </div>
  </Dialog>;
};
export default RemuxModal;
