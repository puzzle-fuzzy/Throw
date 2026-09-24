import { Button, Card, Kbd, TextArea, Toolbar } from '@heroui/react';
import { ArrowUp, Paperclip } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import { PRECHECK } from '../lib/api';

interface InputBarProps {
  disabled: boolean;
  onSendText: (content: string) => void;
  onOpenFilePicker: () => void;
}

/** 胶囊输入卡片：上为自适应文本区，下为内嵌工具栏（左附件 / 右发送） */
export function InputBar({ disabled, onSendText, onOpenFilePicker }: InputBarProps) {
  const [value, setValue] = useState('');
  const [composing, setComposing] = useState(false);
  const nearLimit = value.length > PRECHECK.MAX_TEXT_CHARS * 0.9;

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed === '' || disabled) return;
    if (trimmed.length > PRECHECK.MAX_TEXT_CHARS) return;
    onSendText(trimmed);
    setValue('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !composing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="px-3 pt-1 pb-3">
      <Card
        variant="secondary"
        className="gap-0 rounded-[26px] border border-separator p-0 shadow-sm"
      >
        <Card.Content className="p-2 pb-0">
          <TextArea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            placeholder={disabled ? '正在恢复连接…' : '发送消息…'}
            variant="secondary"
            disabled={disabled}
            aria-label="消息输入框"
            maxLength={PRECHECK.MAX_TEXT_CHARS}
            rows={1}
            className="max-h-36 w-full resize-none text-[15px] leading-6 [field-sizing:content]"
          />
        </Card.Content>
        <Card.Footer className="px-2 pb-2 pt-1">
          <Toolbar
            aria-label="消息操作"
            className="w-full justify-between gap-2 bg-transparent p-0"
          >
            <Button
              variant="secondary"
              isIconOnly
              aria-label="发送文件"
              isDisabled={disabled}
              onPress={onOpenFilePicker}
              className="rounded-full"
            >
              <Paperclip className="size-5" />
            </Button>
            <div className="flex min-w-0 flex-1 justify-center">
              {nearLimit ? (
                <p className="text-xs text-warning">
                  {value.length}/{PRECHECK.MAX_TEXT_CHARS}
                </p>
              ) : (
                <span className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
                  <Kbd>Enter</Kbd>
                  发送
                  <span aria-hidden="true">·</span>
                  <Kbd>Shift + Enter</Kbd>
                  换行
                </span>
              )}
            </div>
            <Button
              variant="primary"
              isIconOnly
              aria-label="发送"
              isDisabled={disabled || value.trim() === '' || value.length > PRECHECK.MAX_TEXT_CHARS}
              onPress={submit}
              className="rounded-full"
            >
              <ArrowUp className="size-5" />
            </Button>
          </Toolbar>
        </Card.Footer>
      </Card>
    </div>
  );
}
