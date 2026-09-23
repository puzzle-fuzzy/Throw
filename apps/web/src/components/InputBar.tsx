import { Button, TextArea } from '@heroui/react';
import { ArrowUp, Paperclip } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { PRECHECK } from '../lib/api';

interface InputBarProps {
  disabled: boolean;
  onSendText: (content: string) => void;
  onPickFiles: (files: File[]) => void;
}

/** 胶囊输入卡片：上为自适应文本区，下为内嵌工具栏（左附件 / 右发送） */
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
    <div className="px-3 pt-1 pb-3">
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
      <div className="rounded-[26px] border border-separator bg-background p-2 shadow-sm">
        <TextArea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          placeholder={disabled ? '连接中断…' : '发送文本或文件…（Enter 发送，Shift+Enter 换行）'}
          variant="secondary"
          disabled={disabled}
          aria-label="消息输入框"
          rows={1}
          className="max-h-36! w-full resize-none border-0! bg-transparent! px-3! pt-2.5! pb-1! text-[15px]! leading-6! shadow-none! [field-sizing:content]"
        />
        <div className="flex items-center gap-2 pt-1">
          <Button
            variant="secondary"
            isIconOnly
            aria-label="发送文件"
            isDisabled={disabled}
            onPress={() => fileInputRef.current?.click()}
            className="rounded-full"
          >
            <Paperclip className="size-5" />
          </Button>
          {nearLimit && (
            <p className="flex-1 text-center text-xs text-warning">
              {value.length}/{PRECHECK.MAX_TEXT_CHARS}
            </p>
          )}
          <span className={nearLimit ? 'hidden' : 'flex-1'} />
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
        </div>
      </div>
    </div>
  );
}
