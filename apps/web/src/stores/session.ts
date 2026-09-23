import { create } from 'zustand';

export interface RoomSession {
  code: string;
  token: string;
  role: 'creator' | 'joiner';
}

interface SessionState {
  nickname: string | null;
  room: RoomSession | null;
  setNickname: (nickname: string | null) => void;
  setRoom: (room: RoomSession | null) => void;
}

const NICKNAME_KEY = 'throw-nickname';
const ROOM_KEY = 'throw-room-session';

function readNickname(): string | null {
  try {
    return localStorage.getItem(NICKNAME_KEY);
  } catch {
    return null;
  }
}

/** 房间会话放 sessionStorage：刷新可恢复（服务端 5 分钟宽限），关标签页即丢 */
function readRoom(): RoomSession | null {
  try {
    const raw = sessionStorage.getItem(ROOM_KEY);
    return raw ? (JSON.parse(raw) as RoomSession) : null;
  } catch {
    return null;
  }
}

function writeRoom(room: RoomSession | null): void {
  try {
    if (room) sessionStorage.setItem(ROOM_KEY, JSON.stringify(room));
    else sessionStorage.removeItem(ROOM_KEY);
  } catch {
    // 隐私模式忽略
  }
}

export const useSession = create<SessionState>((set) => ({
  nickname: typeof window === 'undefined' ? null : readNickname(),
  room: typeof window === 'undefined' ? null : readRoom(),
  setNickname: (nickname) => {
    try {
      if (nickname) localStorage.setItem(NICKNAME_KEY, nickname);
      else localStorage.removeItem(NICKNAME_KEY);
    } catch {
      // 隐私模式忽略
    }
    set({ nickname });
  },
  setRoom: (room) => {
    writeRoom(room);
    set({ room });
  },
}));
