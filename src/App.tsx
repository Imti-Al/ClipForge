import { useState } from 'react';
import MainEditor from './components/MainEditor';
import { ExportModal } from './components/ExportModal';
import RemuxModal from './components/RemuxModal';

export type ModalType = 'export' | 'remux' | null;

function App() {
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [videoSrc, setVideoSrc] = useState<string>('');
  const [inTime, setInTime] = useState(0);
  const [outTime, setOutTime] = useState(600);

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
        onVideoStateChange={(src, _duration, inT, outT) => {
          setVideoSrc(src);
          setInTime(inT);
          setOutTime(outT);
        }}
      />
      
      {activeModal === 'export' && (
        <ExportModal 
          onClose={handleCloseModal}
          videoSrc={videoSrc}
          inTime={inTime}
          outTime={outTime}
        />
      )}
      
      {activeModal === 'remux' && (
        <RemuxModal onClose={handleCloseModal} />
      )}
    </div>
  );
}

export default App;
