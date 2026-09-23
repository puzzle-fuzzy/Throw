import { Modal } from '@heroui/react';
import type { ReactNode } from 'react';

interface ImageViewerProps {
  src: string;
  alt: string;
  /** trigger 元素（缩略图按钮），点击后放大预览 */
  children: ReactNode;
}

export function ImageViewer({ src, alt, children }: ImageViewerProps) {
  return (
    <Modal>
      {children}
      <Modal.Backdrop>
        <Modal.Container size="cover">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Body className="flex items-center justify-center bg-black/95 p-2">
              <img src={src} alt={alt} className="max-h-[80vh] max-w-full object-contain" />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
