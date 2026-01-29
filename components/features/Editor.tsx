"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Youtube from '@tiptap/extension-youtube';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Placeholder from '@tiptap/extension-placeholder';
import { Node, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  Palette,
  FileVideo,
  Image as ImageIcon,
  Music,
  Plus,
  Type,
} from 'lucide-react';
import { useCallback, useState, useRef, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

const Video = Node.create({
  name: 'video',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true },
    };
  },
  parseHTML() {
    return [{ tag: 'video' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'video',
      {
        ...HTMLAttributes,
        controls: HTMLAttributes.controls ? 'controls' : undefined,
        class:
          'w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-black',
      },
    ];
  },
});

const Audio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      controls: { default: true },
    };
  },
  parseHTML() {
    return [{ tag: 'audio' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'audio',
      {
        ...HTMLAttributes,
        controls: HTMLAttributes.controls ? 'controls' : undefined,
        class:
          'w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950',
      },
    ];
  },
});

const COLORS = [
  { name: 'Default', color: 'inherit' },
  { name: 'Gray', color: '#6B7280' },
  { name: 'Brown', color: '#92400E' },
  { name: 'Orange', color: '#EA580C' },
  { name: 'Yellow', color: '#CA8A04' },
  { name: 'Green', color: '#16A34A' },
  { name: 'Blue', color: '#2563EB' },
  { name: 'Purple', color: '#9333EA' },
  { name: 'Pink', color: '#DB2777' },
  { name: 'Red', color: '#DC2626' },
];

const FontSize = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => {
              const raw = (element as HTMLElement).style.fontSize;
              return raw || null;
            },
            renderHTML: (attributes) => {
              const value = attributes.fontSize as string | null | undefined;
              if (!value) return {};
              return { style: `font-size: ${value}` };
            },
          },
        },
      },
    ];
  },
});

type AiDiffInput = { before: string; after: string };

type MyersOp<T> =
  | { type: 'equal'; value: T }
  | { type: 'insert'; value: T }
  | { type: 'delete'; value: T };

function myersDiff<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean): MyersOp<T>[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  v[offset + 1] = 0;
  for (let d = 0; d <= max; d++) {
    const nextV = new Int32Array(v);
    for (let k = -d; k <= d; k += 2) {
      const kIndex = offset + k;
      let x: number;
      if (k === -d || (k !== d && v[kIndex - 1] < v[kIndex + 1])) {
        x = v[kIndex + 1];
      } else {
        x = v[kIndex - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && equals(a[x], b[y])) {
        x++;
        y++;
      }
      nextV[kIndex] = x;
      if (x >= n && y >= m) {
        trace.push(nextV);
        const ops: MyersOp<T>[] = [];
        let cx = n;
        let cy = m;
        for (let td = trace.length - 1; td >= 0; td--) {
          const tv = trace[td]!;
          const cd = td;
          const ck = cx - cy;
          const ckIndex = offset + ck;
          let prevK: number;
          if (ck === -cd || (ck !== cd && tv[ckIndex - 1] < tv[ckIndex + 1])) {
            prevK = ck + 1;
          } else {
            prevK = ck - 1;
          }
          const prevX = tv[offset + prevK];
          const prevY = prevX - prevK;
          while (cx > prevX && cy > prevY) {
            ops.push({ type: 'equal', value: b[cy - 1]! });
            cx--;
            cy--;
          }
          if (cd === 0) break;
          if (cx === prevX) {
            ops.push({ type: 'insert', value: b[cy - 1]! });
            cy--;
          } else {
            ops.push({ type: 'delete', value: a[cx - 1]! });
            cx--;
          }
        }
        ops.reverse();
        const compact: MyersOp<T>[] = [];
        for (const op of ops) {
          const last = compact[compact.length - 1];
          if (last && last.type === op.type) {
            compact.push(op);
          } else {
            compact.push(op);
          }
        }
        return compact;
      }
    }
    trace.push(nextV);
    v = nextV;
  }
  return [];
}

function htmlToLines(html: string): string[] {
  const raw = (html ?? '').toString();
  if (!raw.trim()) return [];
  if (typeof window === 'undefined') return [];
  try {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const blocks = doc.body.querySelectorAll('p,pre,blockquote p,h1,h2,h3,h4,h5,h6');
    if (blocks.length > 0) {
      return Array.from(blocks)
        .map((el) => ((el.textContent ?? '').toString().replace(/\s+$/g, '')));
    }
    const text = (doc.body.textContent ?? '').toString();
    return text
      .split(/\r?\n/g)
      .map((line) => line.replace(/\s+$/g, ''));
  } catch {
    return [];
  }
}

const AI_DIFF_META = 'ai-diff:recompute';
const aiDiffPluginKey = new PluginKey('ai-diff');

const AiDiffDecorations = Extension.create<{ getDiff: () => AiDiffInput | null }>({
  name: 'aiDiffDecorations',
  addOptions() {
    return {
      getDiff: () => null,
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: aiDiffPluginKey,
        state: {
          init: (_, state) => {
            const diff = this.options.getDiff();
            if (!diff) return DecorationSet.empty;
            return buildAiDiffDecorations(state.doc, diff);
          },
          apply: (tr, prev, _oldState, newState) => {
            if (tr.getMeta(AI_DIFF_META) || tr.docChanged) {
              const diff = this.options.getDiff();
              if (!diff) return DecorationSet.empty;
              return buildAiDiffDecorations(newState.doc, diff);
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return aiDiffPluginKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});

function buildAiDiffDecorations(doc: ProseMirrorNode, diff: AiDiffInput): DecorationSet {
  const beforeLines = htmlToLines(diff.before);
  const afterLines = htmlToLines(diff.after);
  if (beforeLines.length === 0 && afterLines.length === 0) return DecorationSet.empty;

  const ops = myersDiff(beforeLines, afterLines, (x, y) => x === y);
  const blocks: { pos: number; nodeSize: number; contentSize: number }[] = [];
  doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.isTextblock) {
      blocks.push({ pos, nodeSize: node.nodeSize, contentSize: node.content.size });
    }
  });

  const decorations: Decoration[] = [];
  let afterIndex = 0;
  for (const op of ops) {
    if (op.type === 'equal') {
      afterIndex++;
      continue;
    }
    if (op.type === 'insert') {
      const block = blocks[afterIndex];
      if (block) {
        decorations.push(Decoration.node(block.pos, block.pos + block.nodeSize, { class: 'ai-diff-insert' }));
        if (block.contentSize > 0) {
          decorations.push(
            Decoration.inline(block.pos + 1, block.pos + block.nodeSize - 1, { class: 'ai-diff-insert' })
          );
        }
      }
      afterIndex++;
      continue;
    }
    if (op.type === 'delete') {
      const insertPos = afterIndex < blocks.length ? blocks[afterIndex]!.pos : doc.content.size;
      const text = (op.value ?? '').toString();
      if (text.trim().length === 0) continue;
      decorations.push(
        Decoration.widget(
          insertPos,
          () => {
            const el = document.createElement('div');
            el.className = 'ai-diff-delete-widget';
            el.textContent = text;
            return el;
          },
          { side: -1 }
        )
      );
    }
  }

  return DecorationSet.create(doc, decorations);
}

export default function Editor({
  initialContent = '',
  value,
  onUpdate,
  editable = true,
  diff,
}: {
  initialContent?: string;
  value?: string;
  onUpdate?: (content: string) => void;
  editable?: boolean;
  diff?: AiDiffInput | null;
}) {
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const onUpdateRef = useRef(onUpdate);
  const suppressUpdateRef = useRef(false);
  const lastValueRef = useRef<string | null>(null);
  const diffRef = useRef<AiDiffInput | null>(diff ?? null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const editorWrapperRef = useRef<HTMLDivElement | null>(null);
  const pendingInsertPosRef = useRef<number | null>(null);

  const [hoverAnchor, setHoverAnchor] = useState<{
    top: number;
    left: number;
    blockPos: number;
    insertPosBelow: number;
    insertPosAbove: number;
    blockTop: number;
    blockLeft: number;
    blockWidth: number;
    blockHeight: number;
  } | null>(null);
  const [showBlockMenu, setShowBlockMenu] = useState(false);
  const [blockMenuQuery, setBlockMenuQuery] = useState('');
  const blockMenuInputRef = useRef<HTMLInputElement | null>(null);
  const [showPlusTip, setShowPlusTip] = useState(false);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  const editor = useEditor({
    extensions: [
      TextStyle,
      Color,
      FontSize,
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Image,
      Video,
      Audio,
      Youtube.configure({
        controls: false,
      }),
      Placeholder.configure({
        placeholder: 'Type something wonderful...',
      }),
      AiDiffDecorations.configure({
        getDiff: () => diffRef.current,
      }),
    ],
    content: typeof value === 'string' ? value : initialContent,
    editable,
    onUpdate: ({ editor }) => {
      if (suppressUpdateRef.current) return;
      onUpdateRef.current?.(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-zinc dark:prose-invert max-w-none focus:outline-none min-h-[300px] prose-p:my-1 prose-headings:my-2 prose-li:my-0 leading-normal prose-strong:text-inherit',
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    diffRef.current = diff ?? null;
    if (!editor) return;
    editor.view.dispatch(editor.view.state.tr.setMeta(AI_DIFF_META, Date.now()));
  }, [diff, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(Boolean(editable));
  }, [editor, editable]);

  useEffect(() => {
    if (!editor) return;
    if (typeof value !== 'string') return;
    if (lastValueRef.current === value) return;
    lastValueRef.current = value;
    suppressUpdateRef.current = true;
    editor.commands.setContent(value, { emitUpdate: false });
    queueMicrotask(() => {
      suppressUpdateRef.current = false;
    });
  }, [editor, value]);

  const uploadToSupabase = useCallback(async (file: File) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      throw new Error('Not signed in');
    }

    const bucket = 'chat-attachments';
    const key = `${uid}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from(bucket).upload(key, file, {
      contentType: file.type,
      upsert: false,
    });
    if (error) {
      throw new Error(error.message);
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(key);
    if (!data.publicUrl) {
      throw new Error('Failed to get public url');
    }
    return data.publicUrl;
  }, []);

  const onPickImage = useCallback(() => {
    if (isUploading) return;
    imageInputRef.current?.click();
  }, [isUploading]);

  const onPickVideo = useCallback(() => {
    if (isUploading) return;
    videoInputRef.current?.click();
  }, [isUploading]);

  const onPickAudio = useCallback(() => {
    if (isUploading) return;
    audioInputRef.current?.click();
  }, [isUploading]);

  const onImageSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      e.target.value = '';
      if (!file || !editor) return;
      try {
        setIsUploading(true);
        const url = await uploadToSupabase(file);
        const insertPos = pendingInsertPosRef.current;
        if (typeof insertPos === 'number') {
          editor.chain().focus().insertContentAt(insertPos, { type: 'image', attrs: { src: url } }).run();
        } else {
          editor.chain().focus().setImage({ src: url }).run();
        }
        pendingInsertPosRef.current = null;
        setShowBlockMenu(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        window.alert(message);
      } finally {
        setIsUploading(false);
      }
    },
    [editor, uploadToSupabase]
  );

  const onVideoSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      e.target.value = '';
      if (!file || !editor) return;
      try {
        setIsUploading(true);
        const url = await uploadToSupabase(file);
        const insertPos = pendingInsertPosRef.current;
        if (typeof insertPos === 'number') {
          editor
            .chain()
            .focus()
            .insertContentAt(insertPos, { type: 'video', attrs: { src: url, controls: true } })
            .run();
        } else {
          editor
            .chain()
            .focus()
            .insertContent({ type: 'video', attrs: { src: url, controls: true } })
            .run();
        }
        pendingInsertPosRef.current = null;
        setShowBlockMenu(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        window.alert(message);
      } finally {
        setIsUploading(false);
      }
    },
    [editor, uploadToSupabase]
  );

  const onAudioSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null;
      e.target.value = '';
      if (!file || !editor) return;
      try {
        setIsUploading(true);
        const url = await uploadToSupabase(file);
        const insertPos = pendingInsertPosRef.current;
        if (typeof insertPos === 'number') {
          editor
            .chain()
            .focus()
            .insertContentAt(insertPos, { type: 'audio', attrs: { src: url, controls: true } })
            .run();
        } else {
          editor
            .chain()
            .focus()
            .insertContent({ type: 'audio', attrs: { src: url, controls: true } })
            .run();
        }
        pendingInsertPosRef.current = null;
        setShowBlockMenu(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        window.alert(message);
      } finally {
        setIsUploading(false);
      }
    },
    [editor, uploadToSupabase]
  );

  const computeBlockAnchorFromTarget = useCallback(
    (target: HTMLElement) => {
      if (!editor) return null;
      const wrapper = editorWrapperRef.current;
      if (!wrapper) return null;
      if (!wrapper.contains(target)) return null;
      if (target.closest('[data-block-plus="1"]')) return null;
      if (target.closest('[data-block-menu="1"]')) return null;
      const block = target.closest('p,h1,h2,h3,li,blockquote,pre') as HTMLElement | null;
      if (!block) return null;
      if (!editor.view.dom.contains(block)) return null;

      const wrapperRect = wrapper.getBoundingClientRect();
      const rect = block.getBoundingClientRect();
      const left = rect.left - wrapperRect.left - 28;
      const top = rect.top - wrapperRect.top + 2;
      const blockLeft = rect.left - wrapperRect.left;
      const blockTop = rect.top - wrapperRect.top;

      let blockPos = 0;
      try {
        blockPos = editor.view.posAtDOM(block, 0);
      } catch {
        return null;
      }

      const $pos = editor.state.doc.resolve(blockPos);
      let depth = $pos.depth;
      while (depth > 0 && !$pos.node(depth).isBlock) depth -= 1;
      const insertPosBelow = depth > 0 ? $pos.after(depth) : blockPos;
      let insertPosAbove = blockPos;
      try {
        insertPosAbove = depth > 0 ? $pos.before(depth) : blockPos;
      } catch {
        insertPosAbove = blockPos;
      }

      return {
        top,
        left,
        blockPos,
        insertPosBelow,
        insertPosAbove,
        blockTop,
        blockLeft,
        blockWidth: rect.width,
        blockHeight: rect.height,
      };
    },
    [editor]
  );

  const onEditorMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!editable) return;
      if (showBlockMenu) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest('[data-block-plus="1"]') || t.closest('[data-block-menu="1"]')) return;
      const anchor = computeBlockAnchorFromTarget(t);
      if (!anchor) {
        setHoverAnchor(null);
        return;
      }
      setHoverAnchor(anchor);
    },
    [computeBlockAnchorFromTarget, editable, showBlockMenu]
  );

  const onEditorMouseLeave = useCallback(() => {
    if (showBlockMenu) return;
    setHoverAnchor(null);
  }, [showBlockMenu]);

  const openBlockMenu = useCallback((insertAbove: boolean) => {
    if (!editor) return;
    if (!hoverAnchor) return;
    pendingInsertPosRef.current = insertAbove ? hoverAnchor.insertPosAbove : hoverAnchor.insertPosBelow;
    editor.chain().focus().setTextSelection(hoverAnchor.blockPos).run();
    setBlockMenuQuery('');
    setShowBlockMenu(true);
    setTimeout(() => blockMenuInputRef.current?.focus(), 0);
  }, [editor, hoverAnchor]);

  const closeBlockMenu = useCallback(() => {
    setShowBlockMenu(false);
    setBlockMenuQuery('');
    pendingInsertPosRef.current = null;
  }, []);

  const setParagraph = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().setParagraph().run();
    closeBlockMenu();
  }, [closeBlockMenu, editor]);

  const setHeading = useCallback(
    (level: 1 | 2 | 3) => {
      if (!editor) return;
      editor.chain().focus().setHeading({ level }).run();
      closeBlockMenu();
    },
    [closeBlockMenu, editor]
  );

  const filtered = useCallback(
    (label: string) => {
      const q = blockMenuQuery.trim().toLowerCase();
      if (!q) return true;
      return label.toLowerCase().includes(q);
    },
    [blockMenuQuery]
  );

  const onBlockMenuKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeBlockMenu();
      }
    },
    [closeBlockMenu]
  );

  if (!editor) {
    return null;
  }

  const activeFontSize = (editor.getAttributes('textStyle') as { fontSize?: string | null }).fontSize ?? null;

  return (
    <div
      className="relative w-full"
      ref={editorWrapperRef}
      onMouseMove={onEditorMouseMove}
      onMouseLeave={onEditorMouseLeave}
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onImageSelected}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={onVideoSelected}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={onAudioSelected}
      />
      {editor && (
        <BubbleMenu
          className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 z-50"
          editor={editor}
          options={{
            placement: 'top-start',
          }}
        >
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              editor.isActive('bold') ? 'bg-zinc-100 text-blue-600 dark:bg-zinc-800 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
            }`}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              editor.isActive('italic') ? 'bg-zinc-100 text-blue-600 dark:bg-zinc-800 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
            }`}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            className={`rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              editor.isActive('underline') ? 'bg-zinc-100 text-blue-600 dark:bg-zinc-800 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
            }`}
            title="Underline"
          >
            <UnderlineIcon className="h-4 w-4" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleStrike().run()}
            className={`rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              editor.isActive('strike') ? 'bg-zinc-100 text-blue-600 dark:bg-zinc-800 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
            }`}
            title="Strikethrough"
          >
            <Strikethrough className="h-4 w-4" />
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

          <button
            onClick={() => {
              const next = activeFontSize === '2.25rem' ? null : '2.25rem';
              editor.chain().focus().setMark('textStyle', { fontSize: next }).removeEmptyTextStyle().run();
            }}
            className={`rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              activeFontSize === '2.25rem' ? 'bg-zinc-100 text-blue-600 dark:bg-zinc-800 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
            }`}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              const next = activeFontSize === '1.875rem' ? null : '1.875rem';
              editor.chain().focus().setMark('textStyle', { fontSize: next }).removeEmptyTextStyle().run();
            }}
            className={`rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              activeFontSize === '1.875rem' ? 'bg-zinc-100 text-blue-600 dark:bg-zinc-800 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
            }`}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              const next = activeFontSize === '1.5rem' ? null : '1.5rem';
              editor.chain().focus().setMark('textStyle', { fontSize: next }).removeEmptyTextStyle().run();
            }}
            className={`rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
              activeFontSize === '1.5rem' ? 'bg-zinc-100 text-blue-600 dark:bg-zinc-800 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
            }`}
            title="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </button>

          <div className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />

          <div className="relative">
            <button
              onClick={() => {
                setShowColorPicker(!showColorPicker);
                setShowBlockMenu(false);
              }}
              className={`rounded p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                showColorPicker ? 'bg-zinc-100 text-blue-600 dark:bg-zinc-800 dark:text-blue-400' : 'text-zinc-600 dark:text-zinc-400'
              }`}
              title="Text Color"
            >
              <Palette className="h-4 w-4" />
            </button>
            {showColorPicker && (
              <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 grid grid-cols-5 gap-1 w-40 z-50">
                {COLORS.map((color) => (
                  <button
                    key={color.name}
                    onClick={() => {
                      editor.chain().focus().setColor(color.color).run();
                      setShowColorPicker(false);
                    }}
                    className="h-6 w-6 rounded-md border border-zinc-100 hover:scale-110 transition-transform dark:border-zinc-800"
                    style={{ backgroundColor: color.color === 'inherit' ? '#000' : color.color }}
                    title={color.name}
                  >
                     {color.color === 'inherit' && <span className="text-[10px] text-white flex justify-center items-center h-full w-full">A</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </BubbleMenu>
      )}

      {editable && hoverAnchor && (
        <button
          type="button"
          data-block-plus="1"
          onMouseEnter={() => setShowPlusTip(true)}
          onMouseLeave={() => setShowPlusTip(false)}
          onClick={(e) => {
            setShowPlusTip(false);
            openBlockMenu(e.altKey);
          }}
          className="absolute z-40 flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          style={{ top: hoverAnchor.top, left: hoverAnchor.left }}
        >
          <Plus className="h-4 w-4" />
        </button>
      )}

      {editable && hoverAnchor && showPlusTip && !showBlockMenu && (
        <div
          data-block-plus="1"
          className="pointer-events-none absolute z-50 max-w-[220px] rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
          style={{ top: hoverAnchor.top - 4, left: hoverAnchor.left + 32 }}
        >
          <div>Click to add below</div>
          <div>Option-click to add above</div>
        </div>
      )}

      {editable && showBlockMenu && hoverAnchor && (
        <div
          data-block-menu="1"
          className="absolute z-50 w-[280px] rounded-xl border border-zinc-200 bg-white p-2 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
          style={{ top: hoverAnchor.top + 28, left: hoverAnchor.left + 26 }}
          onKeyDown={onBlockMenuKeyDown}
        >
          <input
            ref={blockMenuInputRef}
            value={blockMenuQuery}
            onChange={(e) => setBlockMenuQuery(e.target.value)}
            placeholder="Type to filter..."
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
          />

          <div className="mt-2">
            <div className="px-2 py-1 text-xs font-semibold text-zinc-500">Text</div>
            <div className="flex flex-col gap-1">
              {filtered('Text') && (
                <button
                  type="button"
                  onClick={setParagraph}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Type className="h-4 w-4 text-zinc-400" />
                  <span>Text</span>
                </button>
              )}
              {filtered('Heading 1') && (
                <button
                  type="button"
                  onClick={() => setHeading(1)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Heading1 className="h-4 w-4 text-zinc-400" />
                  <span>Heading 1</span>
                </button>
              )}
              {filtered('Heading 2') && (
                <button
                  type="button"
                  onClick={() => setHeading(2)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Heading2 className="h-4 w-4 text-zinc-400" />
                  <span>Heading 2</span>
                </button>
              )}
              {filtered('Heading 3') && (
                <button
                  type="button"
                  onClick={() => setHeading(3)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Heading3 className="h-4 w-4 text-zinc-400" />
                  <span>Heading 3</span>
                </button>
              )}
            </div>
          </div>

          <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <div className="px-2 py-1 text-xs font-semibold text-zinc-500">Media</div>
            <div className="flex flex-col gap-1">
              {filtered('Image') && (
                <button
                  type="button"
                  onClick={onPickImage}
                  disabled={isUploading}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <ImageIcon className="h-4 w-4 text-zinc-400" />
                  <span>{isUploading ? 'Uploading…' : 'Image'}</span>
                </button>
              )}
              {filtered('Video') && (
                <button
                  type="button"
                  onClick={onPickVideo}
                  disabled={isUploading}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <FileVideo className="h-4 w-4 text-zinc-400" />
                  <span>{isUploading ? 'Uploading…' : 'Video'}</span>
                </button>
              )}
              {filtered('Audio') && (
                <button
                  type="button"
                  onClick={onPickAudio}
                  disabled={isUploading}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-60 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <Music className="h-4 w-4 text-zinc-400" />
                  <span>{isUploading ? 'Uploading…' : 'Audio'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
