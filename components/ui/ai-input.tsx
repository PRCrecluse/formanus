'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Children, useCallback, useEffect, useRef, useState } from 'react';
import type {
  ComponentProps,
  HTMLAttributes,
  KeyboardEventHandler,
} from 'react';

type UseAutoResizeTextareaProps = {
  minHeight: number;
  maxHeight?: number;
};

const useAutoResizeTextarea = ({
  minHeight,
  maxHeight,
}: UseAutoResizeTextareaProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(
    (reset?: boolean) => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      if (reset) {
        textarea.style.height = `${minHeight}px`;
        return;
      }

      // Temporarily shrink to get the right scrollHeight
      textarea.style.height = `${minHeight}px`;

      // Calculate new height
      const newHeight = Math.max(
        minHeight,
        Math.min(textarea.scrollHeight, maxHeight ?? Number.POSITIVE_INFINITY)
      );

      textarea.style.height = `${newHeight}px`;
    },
    [minHeight, maxHeight]
  );

  useEffect(() => {
    // Set initial height
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = `${minHeight}px`;
    }
  }, [minHeight]);

  // Adjust height on window resize
  useEffect(() => {
    const handleResize = () => adjustHeight();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [adjustHeight]);

  return { textareaRef, adjustHeight };
};

export type AIInputProps = HTMLAttributes<HTMLFormElement>;

export const AIInput = ({ className, ...props }: AIInputProps) => (
  <form
    className={cn(
      'w-full divide-y divide-zinc-100 overflow-hidden rounded-xl border border-zinc-200 bg-background shadow-sm dark:border-zinc-800 dark:divide-zinc-800',
      className
    )}
    {...props}
  />
);

export type AIInputTextareaProps = ComponentProps<typeof Textarea> & {
  minHeight?: number;
  maxHeight?: number;
};

export const AIInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder = 'What would you like to know?',
  minHeight = 48,
  maxHeight = 164,
  ...props
}: AIInputTextareaProps) => {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight,
    maxHeight,
  });

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;

    if (e.nativeEvent.isComposing) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const form = e.currentTarget.form;
      if (form) {
        form.requestSubmit();
      }
    }
  };

  return (
    <Textarea
      name="message"
      placeholder={placeholder}
      ref={textareaRef}
      className={cn(
        'w-full resize-none rounded-none border-none p-3 shadow-none outline-none ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 focus:ring-0 focus:ring-offset-0',
        className
      )}
      onChange={(e) => {
        adjustHeight();
        onChange?.(e);
      }}
      onKeyDown={handleKeyDown}
      {...props}
    />
  );
};

export type AIInputToolbarProps = HTMLAttributes<HTMLDivElement>;

export const AIInputToolbar = ({
  className,
  ...props
}: AIInputToolbarProps) => (
  <div
    className={cn('flex items-center justify-between p-1', className)}
    {...props}
  />
);

export type AIInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const AIInputTools = ({ className, ...props }: AIInputToolsProps) => (
  <div className={cn('flex items-center gap-1', className)} {...props} />
);

export type AIInputButtonProps = ComponentProps<typeof Button>;

export const AIInputButton = ({
  variant = 'ghost',
  className,
  size,
  type = 'button',
  ...props
}: AIInputButtonProps) => {
  const newSize =
    (size ?? Children.count(props.children) > 1) ? 'default' : 'icon';

  return (
    <Button
      type={type}
      variant={variant}
      size={newSize}
      className={cn(
        'shrink-0 gap-1.5 text-muted-foreground',
        newSize === 'default' && 'px-3',
        className
      )}
      {...props}
    />
  );
};

export type AIInputFileUploadButtonProps = AIInputButtonProps & {
  onFileSelect?: (file: File) => void;
};

export const AIInputFileUploadButton = ({
  onFileSelect,
  onClick,
  ...props
}: AIInputFileUploadButtonProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e);
    inputRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    files.forEach((file) => onFileSelect?.(file));
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  return (
    <>
      <input
        type="file"
        ref={inputRef}
        className="hidden"
        onChange={handleChange}
        multiple
      />
      <AIInputButton onClick={handleClick} {...props} />
    </>
  );
};

export type AIInputVoiceButtonProps = AIInputButtonProps & {
  onRecordingComplete?: (blob: Blob) => void;
  onTranscript?: (text: string) => void;
  language?: string;
};

type SpeechRecognitionResultLike = { isFinal: boolean; 0: { transcript?: string | null } };
type SpeechRecognitionEventLike = { resultIndex: number; results: ArrayLike<SpeechRecognitionResultLike> };
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtorLike = new () => SpeechRecognitionLike;

export const AIInputVoiceButton = ({
  onRecordingComplete,
  onTranscript,
  language,
  className,
  onClick,
  ...props
}: AIInputVoiceButtonProps) => {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const AnySpeechRecognition =
      ((window as unknown as { SpeechRecognition?: SpeechRecognitionCtorLike }).SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtorLike }).webkitSpeechRecognition ??
        null) as SpeechRecognitionCtorLike | null;
    if (!AnySpeechRecognition) return;
    const recognition = new AnySpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = (language ?? navigator.language ?? "en-US").toString();
    recognition.onresult = (e: SpeechRecognitionEventLike) => {
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        const text = (result[0]?.transcript ?? "").toString();
        if (result.isFinal) finalText += text;
      }
      if (finalText) transcriptRef.current = `${transcriptRef.current} ${finalText}`.trim();
    };
    recognition.onend = () => {
      setIsRecording(false);
      const t = transcriptRef.current.trim();
      if (t) onTranscript?.(t);
      transcriptRef.current = "";
    };
    recognition.onerror = () => {
      setIsRecording(false);
    };
    recognitionRef.current = recognition;
  }, [language, onTranscript]);

  const startRecording = async () => {
    if (recognitionRef.current) {
      transcriptRef.current = "";
      setIsRecording(true);
      recognitionRef.current.start();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        onRecordingComplete?.(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      alert('Could not access microphone');
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current && isRecording) {
      try {
        recognitionRef.current.stop();
      } catch {
        setIsRecording(false);
      }
      return;
    }
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      if (isRecording) {
          stopRecording();
      } else {
          startRecording();
      }
  };

  return (
    <AIInputButton
      onClick={handleClick}
      className={cn(className, isRecording && "text-red-500 animate-pulse bg-red-100 dark:bg-red-900/20")}
      {...props}
    />
  );
};

export type AIInputSubmitProps = ComponentProps<typeof Button>;

export const AIInputSubmit = ({
  className,
  variant = 'ghost',
  size = 'icon',
  ...props
}: AIInputSubmitProps) => (
  <Button
    type="submit"
    variant={variant}
    size={size}
    className={cn('gap-1.5 text-muted-foreground', className)}
    {...props}
  />
);

export type AIInputModelSelectProps = ComponentProps<typeof Select>;

export const AIInputModelSelect = (props: AIInputModelSelectProps) => (
  <Select {...props} />
);

export type AIInputModelSelectTriggerProps = ComponentProps<
  typeof SelectTrigger
>;

export const AIInputModelSelectTrigger = ({
  className,
  ...props
}: AIInputModelSelectTriggerProps) => (
  <SelectTrigger
    className={cn(
      'border-none bg-transparent font-medium text-muted-foreground shadow-none transition-colors',
      'hover:bg-accent hover:text-foreground [&[aria-expanded="true"]]:bg-accent [&[aria-expanded="true"]]:text-foreground',
      'focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0',
      className
    )}
    {...props}
  />
);

export type AIInputModelSelectContentProps = ComponentProps<
  typeof SelectContent
>;

export const AIInputModelSelectContent = ({
  className,
  ...props
}: AIInputModelSelectContentProps) => (
  <SelectContent className={cn(className)} {...props} />
);

export type AIInputModelSelectItemProps = ComponentProps<typeof SelectItem>;

export const AIInputModelSelectItem = ({
  className,
  ...props
}: AIInputModelSelectItemProps) => (
  <SelectItem className={cn(className)} {...props} />
);

export type AIInputModelSelectValueProps = ComponentProps<typeof SelectValue>;

export const AIInputModelSelectValue = ({
  className,
  ...props
}: AIInputModelSelectValueProps) => (
  <SelectValue className={cn(className)} {...props} />
);
