import React, { useState } from 'react';
import { unwrapIpc } from '../utils/ipc';
import { X, Upload, Trash2 } from 'lucide-react';
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
      case 'completed': return 'text-emerald-400';
      case 'processing': return 'text-blue-400';
      case 'error': return 'text-red-400';
      default: return 'text-gray-400';
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-800 bg-opacity-95 backdrop-blur-md rounded-lg w-[800px] max-h-[80vh] overflow-hidden border border-slate-600">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-600">
          <h2 className="text-xl font-semibold text-gray-200">Remux Recordings</h2>
          <button 
            onClick={onClose}
            disabled={isRunning}
            className="p-2 hover:bg-slate-700 rounded transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>
        
        <div className="p-6">
          {queueError && <p role="alert" className="mb-3 text-sm text-red-400">{queueError}</p>}
          {/* Drag & Drop Area */}
          <div 
            className={`border-2 border-dashed rounded-lg p-8 text-center mb-6 transition-colors cursor-pointer ${
              isDragging ? 'border-blue-400 bg-blue-500/10' : 'border-slate-600 hover:border-blue-400'
            }`}
            onClick={addMkvFiles}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Upload size={48} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-300 mb-2">
              Click here to select MKV files to remux, or drop files in this window.
            </p>
            <p className="text-sm text-gray-400">
              Supported formats: MKV files
            </p>
          </div>
          
          {/* Table */}
          <div className="bg-slate-900 rounded-lg overflow-hidden">
            <div className="grid grid-cols-2 bg-slate-700 text-sm font-medium text-gray-300">
              <div className="p-3 border-r border-slate-600">MKV File</div>
              <div className="p-3">Target File</div>
            </div>
            
            <div className="max-h-64 overflow-y-auto">
              {items.length === 0 && (
                <div className="p-8 text-center text-gray-400">
                  <p>No files added yet</p>
                  <p className="text-sm mt-1">Click the area above to select MKV files</p>
                </div>
              )}
              {items.map((item) => (
                <div key={item.id} className="border-b border-slate-700 last:border-b-0">
                  <div className="grid grid-cols-2 text-sm">
                    <div className="p-3 border-r border-slate-600">
                      <div className="text-gray-200 truncate" title={item.source}>
                        {item.source}
                      </div>
                    </div>
                    <div className="p-3">
                      <div className="text-gray-200 truncate" title={item.target}>
                        {item.target}
                      </div>
                    </div>
                  </div>
                  
                  {item.error && <details className="px-3 pb-2 text-xs text-red-400">
                    <summary>Remux failed: view details</summary>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all">{item.error}</pre>
                  </details>}
                  {/* Progress bar */}
                  <div className="px-3 pb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs ${getStatusColor(item.status)}`}>
                        {getStatusText(item.status)}
                      </span>
                      {item.status === 'processing' && (
                        <span className="text-xs text-gray-400">{item.duration > 0 ? `${item.progress}%` : 'Duration unavailable'}</span>
                      )}
                    </div>
                    <div className="w-full bg-slate-600 rounded-full h-1">
                      <div 
                        className={`h-1 rounded-full transition-all duration-300 ${
                          item.status === 'completed' ? 'bg-emerald-500' :
                          item.status === 'processing' ? 'bg-blue-500' :
                          item.status === 'error' ? 'bg-red-500' : 'bg-gray-500'
                        }`}
                        style={{ width: `${item.progress}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Action buttons */}
        <div className="flex justify-between p-6 border-t border-slate-600">
          <div className="flex space-x-3">
            <button 
              onClick={clearFinished}
              disabled={isRunning}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded transition-colors flex items-center space-x-2"
            >
              <Trash2 size={16} />
              <span>Clear Finished Items</span>
            </button>
            <button 
              onClick={clearAll}
              disabled={isRunning}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded transition-colors"
            >
              Clear All Items
            </button>
          </div>
          
          <div className="flex space-x-3">
            <button 
              onClick={startRemux}
              disabled={isRunning || !items.some(item => item.status === 'pending')}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
            >
              Remux
            </button>
            <button 
              onClick={onClose}
            disabled={isRunning}
              className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RemuxModal;
