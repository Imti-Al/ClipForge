import { useCallback, useState } from 'react';
import type { ProjectSegment } from './types/electron';
import MainEditor from './components/MainEditor';
import { ExportModal } from './components/ExportModal';
import RemuxModal from './components/RemuxModal';

export type ModalType = 'export' | 'remux' | null;

function App() {
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [inTime, setInTime] = useState(0);
  const [outTime, setOutTime] = useState(0);
  const [segments, setSegments] = useState<ProjectSegment[]>([]);
  const updateVideo = useCallback((src: string, _duration: number, inT: number, outT: number, clips: ProjectSegment[]) => {
    setVideoSrc(src); setInTime(inT); setOutTime(outT); setSegments(clips);
  }, []);

  const handleCloseModal = () => {
    setActiveModal(null);
  };

  const handleOpenExport = () => {
    setActiveModal('export');
  };

  const handleOpenRemux = () => {
    setActiveModal('remux');
  };

  return (
    <div className="app-shell">
      <MainEditor 
        isModalOpen={activeModal !== null}
        onOpenExport={handleOpenExport}
        onOpenRemux={handleOpenRemux}
        onVideoStateChange={updateVideo}
      />
      
      {activeModal === 'export' && (
        <ExportModal 
          onClose={handleCloseModal}
          videoSrc={videoSrc}
          inTime={inTime}
          outTime={outTime}
          segments={segments}
        />
      )}
      
      {activeModal === 'remux' && (
        <RemuxModal onClose={handleCloseModal} />
      )}
    </div>
  );
}

export default App;
