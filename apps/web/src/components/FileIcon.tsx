import { FileArchive, FileAudio, FileImage, FileText, FileType2, FileVideo } from 'lucide-react';

/** MIME → Lucide 图标（产品约定：图标唯一来源 Lucide） */
export function fileIconFor(mime: string) {
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('audio/')) return FileAudio;
  if (mime.startsWith('text/')) return FileText;
  if (
    mime === 'application/zip' ||
    mime === 'application/x-7z-compressed' ||
    mime === 'application/x-rar-compressed' ||
    mime === 'application/gzip' ||
    mime === 'application/x-tar'
  ) {
    return FileArchive;
  }
  return FileType2;
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function isVideoMime(mime: string): boolean {
  return mime.startsWith('video/');
}
