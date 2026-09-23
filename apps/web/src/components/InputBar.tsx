import { Button, TextArea } from '@heroui/react';
import { Paperclip, SendHorizontal } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { PRECHECK } from '../lib/api';

interface InputBarProps {
  disabled: boolean;
  onSendText: (content: string) => void;
  onPickFiles: (files: File[]) => void;
}

export function InputBar({ disabled, onSendText, onPickFiles }: InputBarProps) {
  const [value, setValue] = useState('');
  const [composing, setComposing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    <div className="border-t border-separator px-3 pt-2 pb-3">
      <div className="flex items-end gap-2">
        <Button
          variant="ghost"
          isIconOnly
          aria-label="发送文件"
          isDisabled={disabled}
          onPress={() => fileInputRef.current?.click()}
        >
          <Paperclip className="size-5" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            if (files.length > 0) onPickFiles(files);
          }}
        />
        <div className="min-w-0 flex-1">
          <TextArea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            placeholder={disabled ? '连接中断…' : '发送文本，Enter 发送'}
            variant="secondary"
            rows={2}
            disabled={disabled}
            aria-label="消息输入框"
          />
          {nearLimit && (
            <p className="mt-1 text-right text-xs text-warning">
              {value.length}/{PRECHECK.MAX_TEXT_CHARS}
            </p>
          )}
        </div>
        <Button
          variant="primary"
          isIconOnly
          aria-label="发送"
          isDisabled={disabled || value.trim() === '' || value.length > PRECHECK.MAX_TEXT_CHARS}
          onPress={submit}
        >
          <SendHorizontal className="size-5" />
        </Button>
      </div>
    </div>
  );
}
