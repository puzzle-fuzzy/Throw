import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoomPage } from '../src/pages/RoomPage';

const runtime = vi.hoisted(() => ({
  room: {
    phase: 'waiting',
    closeReason: null,
    wsStatus: 'open',
    reconnectAttempt: 0,
    channel: null,
    peer: null,
    peerLeftAt: null,
    expiresAt: 1_800_000_000_000,
    forceRelay: false,
  },
  session: {
    room: { code: 'ABC123', token: 'test-token', role: 'creator' as const },
    setRoom: vi.fn(),
  },
  chat: { clear: vi.fn() },
  theme: { toggle: vi.fn() },
  connection: {
    leave: vi.fn(),
    sendText: vi.fn(() => true),
    sendFiles: vi.fn(() => Promise.resolve()),
    cancelTransfer: vi.fn(),
    retryTransfer: vi.fn(),
  },
  toast: {
    danger: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('@heroui/react', () => ({
  Surface: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
  toast: runtime.toast,
}));

vi.mock('../src/hooks/useRoom', () => ({
  useRoomConnection: () => runtime.connection,
}));

vi.mock('../src/stores/room', () => ({
  useRoom: <T,>(selector: (state: typeof runtime.room) => T) => selector(runtime.room),
}));

vi.mock('../src/stores/session', () => ({
  useSession: <T,>(selector: (state: typeof runtime.session) => T) => selector(runtime.session),
}));

vi.mock('../src/stores/chat', () => ({
  useChat: <T,>(selector: (state: typeof runtime.chat) => T) => selector(runtime.chat),
}));

vi.mock('../src/theme', () => ({
  useTheme: () => runtime.theme,
}));

vi.mock('../src/components/RoomHeader', () => ({
  RoomHeader: () => <div data-testid="room-header" />,
}));

vi.mock('../src/components/WaitingPanel', () => ({
  WaitingPanel: () => <div data-testid="waiting-panel" />,
}));

vi.mock('../src/components/InputBar', () => ({
  InputBar: () => <div data-testid="input-bar" />,
}));

vi.mock('../src/components/MessageList', () => ({
  MessageList: () => <div data-testid="message-list" />,
}));

vi.mock('../src/components/Overlays', () => ({
  ConnectingOverlay: () => <div data-testid="connecting-overlay" />,
  EndOverlay: () => <div data-testid="end-overlay" />,
  PeerLeftNotice: () => <div data-testid="peer-left-notice" />,
}));

function renderRoom() {
  return render(
    <MemoryRouter initialEntries={['/r/ABC123']}>
      <Routes>
        <Route path="/r/:code" element={<RoomPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setPhase(phase: 'waiting' | 'connected' | 'peer-left') {
  Object.assign(runtime.room, {
    phase,
    closeReason: null,
    peerLeftAt: phase === 'peer-left' ? Date.now() : null,
    wsStatus: 'open',
  });
}

function dispatchFileEntryEvents() {
  const file = new File(['test'], 'test.txt', { type: 'text/plain' });
  fireEvent.drop(window, {
    dataTransfer: { files: [file], types: ['Files'] },
  });
  fireEvent.paste(window, {
    clipboardData: { files: [file] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setPhase('waiting');
});

afterEach(() => {
  cleanup();
});

describe('RoomPage room lifecycle', () => {
  it('waiting state is an invitation lobby and does not mount the composer', () => {
    renderRoom();

    expect(screen.getByTestId('waiting-panel')).toBeTruthy();
    expect(screen.queryByTestId('input-bar')).toBeNull();
  });

  it('peer-left preserves the timeline and shows a recoverable notice instead of the end overlay', () => {
    setPhase('peer-left');
    renderRoom();

    expect(screen.getByTestId('message-list')).toBeTruthy();
    expect(screen.getByTestId('peer-left-notice')).toBeTruthy();
    expect(screen.queryByTestId('end-overlay')).toBeNull();
    expect(screen.queryByTestId('input-bar')).toBeNull();
  });

  it.each(['waiting', 'peer-left'] as const)(
    '%s state ignores dropped and pasted files',
    (phase) => {
      setPhase(phase);
      renderRoom();

      dispatchFileEntryEvents();

      expect(runtime.connection.sendFiles).not.toHaveBeenCalled();
    },
  );

  it('connected state still accepts dropped and pasted files', () => {
    setPhase('connected');
    renderRoom();

    dispatchFileEntryEvents();

    expect(runtime.connection.sendFiles).toHaveBeenCalledTimes(2);
    expect(runtime.connection.sendFiles).toHaveBeenNthCalledWith(
      1,
      expect.arrayContaining([expect.any(File)]),
    );
  });
});
