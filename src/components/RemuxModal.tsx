import React, { useState } from 'react';
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
}

const RemuxModal: React.FC<RemuxModalProps> = ({ onClose }) => {
  const [items, setItems] = useState<RemuxItem[]>([
    // Start with empty list - users will add files via drag & drop or file selection
  ]);
  const [isDragging, setIsDragging] = useState(false);

  const buildItemsFromPaths = async (filePaths: string[]) => Promise.all(filePaths.map(async (filePath, index) => {
    const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
    const nameWithoutExt = fileName.replace(/\.mkv$/i, '');
    const lastSeparator = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    const directory = lastSeparator >= 0 ? filePath.slice(0, lastSeparator) : '';
    const info = window.electronAPI ? await window.electronAPI.getVideoInfo(filePath) : null;

    return {
      id: `${Date.now()}-${index}-${fileName}`,
      source: filePath,
      target: `${directory}/${nameWithoutExt}.mp4`,
      status: 'pending' as const,
      progress: 0,
      duration: info?.duration || 0
    };
  }));

  const addMkvFiles = async () => {
    if (!window.electronAPI) return;
    
    try {
      const filePaths = await window.electronAPI.selectMkvFiles();
      const newItems: RemuxItem[] = await buildItemsFromPaths(filePaths);
      
      setItems(prev => [...prev, ...newItems]);
    } catch (error) {
      console.error('Failed to select MKV files:', error);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const filePaths = Array.from(e.dataTransfer.files ?? [])
      .map((file) => (file as File & { path?: string }).path)
      .filter((filePath): filePath is string => Boolean(filePath) && /\.mkv$/i.test(filePath));

    if (filePaths.length === 0) return;
    void buildItemsFromPaths(filePaths).then((newItems) => {
      setItems(prev => [...prev, ...newItems]);
    });
  };

  const clearFinished = () => {
    setItems(items.filter(item => item.status !== 'completed'));
  };

  const clearAll = () => {
    setItems([]);
  };

  const startRemux = async () => {
    if (!window.electronAPI) {
      // Fallback simulation for web development
      setItems(prevItems => 
        prevItems.map(item => 
          item.status === 'pending' 
            ? { ...item, status: 'processing' as const }
            : item
        )
      );
      return;
    }

    const pendingItems = items.filter(item => item.status === 'pending');
    
    // Set all pending items to processing
    setItems(prevItems => 
      prevItems.map(item => 
        item.status === 'pending' 
          ? { ...item, status: 'processing' as const }
          : item
      )
    );

    // Listen for progress updates
    const removeProgressListener = window.electronAPI.onRemuxProgress((data: RemuxProgress) => {
      setItems(prevItems => 
        prevItems.map(item => 
          item.source === data.inputPath 
            ? {
                ...item,
                progress: data.progress !== undefined
                  ? data.progress
                  : item.duration > 0
                    ? Math.min(99, Math.round((data.currentTime / item.duration) * 100))
                    : item.progress
              }
            : item
        )
      );
    });

    // Process each item sequentially
    for (const item of pendingItems) {
      try {
        const options: RemuxOptions = {
          inputPath: item.source,
          outputPath: item.target,
          duration: item.duration
        };

        const result = await window.electronAPI.remuxVideo(options);
        
        if (result.success) {
          setItems(prevItems => 
            prevItems.map(prevItem => 
              prevItem.id === item.id 
                ? { ...prevItem, status: 'completed' as const, progress: 100 }
                : prevItem
            )
          );
        } else {
          setItems(prevItems => 
            prevItems.map(prevItem => 
              prevItem.id === item.id 
                ? { ...prevItem, status: 'error' as const }
                : prevItem
            )
          );
        }
      } catch (error) {
        console.error(`Remux failed for ${item.source}:`, error);
        setItems(prevItems => 
          prevItems.map(prevItem => 
            prevItem.id === item.id 
              ? { ...prevItem, status: 'error' as const }
              : prevItem
          )
        );
      }
    }

    // Clean up progress listener
    removeProgressListener();
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
      case 'processing': return 'Processing...';
      case 'error': return 'Error';
      default: return 'Pending';
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
            className="p-2 hover:bg-slate-700 rounded transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>
        
        <div className="p-6">
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
                  
                  {/* Progress bar */}
                  <div className="px-3 pb-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs ${getStatusColor(item.status)}`}>
                        {getStatusText(item.status)}
                      </span>
                      {item.status === 'processing' && (
                        <span className="text-xs text-gray-400">{item.progress}%</span>
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
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded transition-colors flex items-center space-x-2"
            >
              <Trash2 size={16} />
              <span>Clear Finished Items</span>
            </button>
            <button 
              onClick={clearAll}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-gray-300 rounded transition-colors"
            >
              Clear All Items
            </button>
          </div>
          
          <div className="flex space-x-3">
            <button 
              onClick={startRemux}
              className="px-6 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
            >
              Remux
            </button>
            <button 
              onClick={onClose}
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
