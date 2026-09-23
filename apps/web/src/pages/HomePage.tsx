import {
  Button,
  Card,
  Input,
  InputOTP,
  Label,
  Separator,
  Spinner,
  TextField,
  toast,
} from '@heroui/react';
import { normalizeRoomCode } from '@throw/contracts';
import { Info, MoonStar, Plus, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { createRoom, joinRoom } from '../lib/api';
import { useSession } from '../stores/session';
import { useTheme } from '../theme';

export function HomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setRoom = useSession((state) => state.setRoom);
  const { toggle } = useTheme();
  const [code, setCode] = useState(() => normalizeRoomCode(searchParams.get('code') ?? ''));
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    if (searchParams.get('code')) {
      setCode(normalizeRoomCode(searchParams.get('code') ?? ''));
    }
  }, [searchParams]);

  const codeValid = code.length === 6;

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const room = await createRoom();
      setRoom({ code: room.code, token: room.token, role: 'creator' });
      navigate(`/r/${room.code}`);
    } catch (error) {
      toast.danger(error instanceof Error ? error.message : '创建房间失败');
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    if (joining || !codeValid) return;
    setJoining(true);
    setJoinError(null);
    try {
      const room = await joinRoom(code);
      setRoom({ code, token: room.token, role: 'joiner' });
      navigate(`/r/${code}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '加入房间失败';
      setJoinError(message);
    } finally {
      setJoining(false);
    }
  };

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-4 py-10">
      <Button
        variant="ghost"
        isIconOnly
        aria-label="切换亮暗主题"
        className="fixed end-4 top-4"
        onPress={toggle}
      >
        <MoonStar className="size-5" />
      </Button>

      <div className="mb-8 text-center">
        <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
          <Send className="size-8" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Throw</h1>
        <p className="mt-1 text-sm text-muted">临时一对一传输房间 · 用完即走</p>
      </div>

      <Card className="p-0">
        <Card.Content className="flex flex-col gap-4 p-6">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            isDisabled={creating}
            onPress={() => void handleCreate()}
          >
            {creating ? <Spinner size="sm" /> : <Plus className="size-4" />}
            创建房间
          </Button>

          <div className="flex items-center gap-3 text-xs text-muted">
            <Separator className="flex-1" />
            或
            <Separator className="flex-1" />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-center text-sm font-medium">房间码</span>
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={code}
                onChange={(value) => {
                  setCode(normalizeRoomCode(value));
                  setJoinError(null);
                }}
                aria-label="房间码输入"
              >
                <InputOTP.Group>
                  {[0, 1, 2, 3, 4, 5].map((index) => (
                    <InputOTP.Slot key={index} index={index} />
                  ))}
                </InputOTP.Group>
              </InputOTP>
            </div>
            {joinError && <p className="text-center text-sm text-danger">{joinError}</p>}
            <Button
              variant="outline"
              fullWidth
              isDisabled={!codeValid || joining}
              onPress={() => void handleJoin()}
            >
              {joining ? <Spinner size="sm" /> : null}
              加入房间
            </Button>
          </div>
        </Card.Content>
      </Card>

      <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
        <Info className="size-3.5" />
        一对一 · 临时会话 · 文件优先点对点直传，不落云端
      </p>
    </main>
  );
}
