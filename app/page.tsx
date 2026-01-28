"use client";

import { useState, useEffect, useRef, type FormEventHandler } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  AIInput,
  AIInputButton,
  AIInputModelSelect,
  AIInputModelSelectContent,
  AIInputModelSelectItem,
  AIInputModelSelectTrigger,
  AIInputTextarea,
  AIInputToolbar,
  AIInputTools,
  AIInputFileUploadButton,
  AIInputVoiceButton,
} from "@/components/ui/ai-input";
import { Plus, Mic } from "lucide-react";

// Mock personas
const personas = [
  { id: "p1", name: "Elon Musk Clone" },
  { id: "p2", name: "Coding Assistant" },
  { id: "p3", name: "Creative Writer" },
];

function TypewriterTitle({ text }: { text: string }) {
  const [displayedText, setDisplayedText] = useState("");
  const [isCursorVisible, setIsCursorVisible] = useState(true);

  useEffect(() => {
    let index = 0;
    const intervalId = setInterval(() => {
      setDisplayedText(text.slice(0, index + 1));
      index++;
      if (index >= text.length) {
        clearInterval(intervalId);
      }
    }, 50);

    return () => clearInterval(intervalId);
  }, [text]);

  useEffect(() => {
    const cursorInterval = setInterval(() => {
      setIsCursorVisible((v) => !v);
    }, 500);
    return () => clearInterval(cursorInterval);
  }, []);

  return (
    <h1 className="mb-8 text-center text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl font-serif">
      {displayedText}
      <span
        className={`${
          isCursorVisible ? "opacity-100" : "opacity-0"
        } transition-opacity duration-100`}
      >
        |
      </span>
    </h1>
  );
}

export default function Home() {
  const router = useRouter();
  const [persona, setPersona] = useState<string>("");
  const [message, setMessage] = useState("");
  const [quickAction, setQuickAction] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [attachedResourceIds, setAttachedResourceIds] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [dragOverInput, setDragOverInput] = useState(false);
  const inputDragDepthRef = useRef(0);

  useEffect(() => {
    const checkAuth = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        router.replace("/landing");
        return;
      }
      const sessionUser = data.session?.user;
      if (sessionUser) {
        setUserId(sessionUser.id);
      } else {
        router.replace("/landing");
      }
    };
    checkAuth();
  }, [router]);

  const uploadFile = async (file: File) => {
    if (!userId) return null;
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random()}.${fileExt}`;
    const filePath = `${userId}/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from('chat-attachments')
      .upload(filePath, file);

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return null;
    }

    const { data } = supabase.storage
      .from('chat-attachments')
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const messageContent = formData.get("message") as string;
    
    if (!messageContent && pendingFiles.length === 0) return;
    if (!userId) {
      alert("Please login first");
      router.push('/login');
      return;
    }

    // Create New Chat
    const { data: newChat, error } = await supabase
      .from('chats')
      .insert({
        user_id: userId,
        title: messageContent.slice(0, 30) || 'New Chat'
      })
      .select()
      .single();
    
    if (error || !newChat) {
      console.error('Error creating chat:', error);
      return;
    }

    // Handle attachments
    let finalContent = messageContent;
    for (const file of pendingFiles) {
        const url = await uploadFile(file);
        if (url) {
            finalContent += `\n\n![Image](${url})`;
        }
    }
    if (attachedResourceIds.length > 0) {
      finalContent += `\n\nAttached resources:\n${attachedResourceIds.map((id) => `- ${id}`).join("\n")}`;
    }
    if (quickAction === "Batch XHS Posts") {
      finalContent += `\n\n(User clicked “Batch XHS Posts” and wants a batch of XHS posts generated.)`;
    }
    if (quickAction === "Design Image") {
      finalContent += `\n\n(User clicked “Design Image” and wants an image generated for the content above.)`;
    }

    // Insert Message
    const { error: msgError } = await supabase
      .from('messages')
      .insert({
        chat_id: newChat.id,
        role: 'user',
        content: finalContent
      });

    if (msgError) {
      console.error('Error sending message:', msgError);
      return;
    }

    // Redirect to chat
    router.push(`/chat/${newChat.id}`);
  };

  const handleFileSelect = (file: File) => {
      setPendingFiles(prev => [...prev, file]);
  };

  const handleVoiceRecorded = async (blob: Blob) => {
      const file = new File([blob], "voice-message.webm", { type: "audio/webm" });
      setPendingFiles(prev => [...prev, file]);
  };

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-white p-4 dark:bg-black">
      <div className="w-full max-w-2xl">
        <TypewriterTitle text="Turn your ideas into a viral social star" />
        
        {pendingFiles.length > 0 && (
            <div className="mb-2 flex gap-2 p-2 border rounded bg-zinc-50 dark:bg-zinc-900">
                <span className="text-xs text-zinc-500">Pending attachments: {pendingFiles.length}</span>
            </div>
        )}

        <AIInput
          onSubmit={handleSubmit}
          className="rounded-2xl divide-y-0 bg-white dark:bg-zinc-900"
        >
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              inputDragDepthRef.current += 1;
              setDragOverInput(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragOverInput) setDragOverInput(true);
              e.dataTransfer.dropEffect = "copy";
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              inputDragDepthRef.current = Math.max(0, inputDragDepthRef.current - 1);
              if (inputDragDepthRef.current === 0) setDragOverInput(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverInput(false);
              inputDragDepthRef.current = 0;

              const files = Array.from(e.dataTransfer.files ?? []);
              if (files.length > 0) {
                files.forEach((f) => handleFileSelect(f));
                return;
              }

              const metaRaw = e.dataTransfer.getData("application/x-board-resource-meta")?.trim();
              if (metaRaw) {
                try {
                  const meta = JSON.parse(metaRaw) as { kind?: "persona" | "doc"; personaId?: string; dbId?: string };
                  if (meta.kind === "persona" && meta.personaId) {
                    setPersona(meta.personaId);
                    return;
                  }
                  if (meta.kind === "doc" && meta.dbId) {
                    setAttachedResourceIds((prev) => (prev.includes(meta.dbId!) ? prev : [...prev, meta.dbId!]));
                    return;
                  }
                } catch {
                  void 0;
                }
              }

              const resourceId =
                e.dataTransfer.getData("application/x-board-resource-id")?.trim() ||
                e.dataTransfer.getData("text/plain")?.trim();
              if (resourceId) {
                setAttachedResourceIds((prev) => (prev.includes(resourceId) ? prev : [...prev, resourceId]));
              }
            }}
            className={dragOverInput ? "relative rounded-2xl ring-2 ring-zinc-900/20 dark:ring-white/20" : "relative"}
          >
            {dragOverInput && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-zinc-50/90 px-4 text-center dark:bg-zinc-950/70">
                <div className="w-full rounded-xl border border-dashed border-zinc-300 py-6 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-200">
                  Drop to attach to chat
                </div>
              </div>
            )}
            <AIInputTextarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={dragOverInput ? "" : "How can I help you today?"}
              minHeight={52}
              className="text-base"
            />
          </div>
          <AIInputToolbar className="px-2 py-1.5">
            <AIInputTools>
              <AIInputFileUploadButton 
                  className="h-9 w-9 rounded-full bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                  onFileSelect={handleFileSelect}
              >
                <Plus className="h-5 w-5 text-zinc-600 dark:text-zinc-300" />
              </AIInputFileUploadButton>
              
              <AIInputVoiceButton 
                  className="rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  onRecordingComplete={handleVoiceRecorded}
              >
                 <Mic className="h-5 w-5" />
              </AIInputVoiceButton>

              <div className="mx-1 h-6 w-px bg-zinc-200 dark:bg-zinc-800" />

              <AIInputModelSelect value={persona} onValueChange={setPersona}>
                <AIInputModelSelectTrigger className="w-auto min-w-[140px]">
                   <span className="mr-2">
                     {persona ? (personas.find(p => p.id === persona)?.name ?? persona) : "Select persona"}
                   </span>
                </AIInputModelSelectTrigger>
                <AIInputModelSelectContent>
                  {persona && !personas.some((p) => p.id === persona) && (
                    <AIInputModelSelectItem value={persona}>
                      {persona}
                    </AIInputModelSelectItem>
                  )}
                  {personas.map((p) => (
                    <AIInputModelSelectItem key={p.id} value={p.id}>
                      {p.name}
                    </AIInputModelSelectItem>
                  ))}
                </AIInputModelSelectContent>
              </AIInputModelSelect>
            </AIInputTools>

            <AIInputButton
              type="submit"
              className="h-9 w-9 rounded-full bg-black p-0 text-white hover:bg-zinc-800"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                className="h-4 w-4"
              >
                <path
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M12 19V5m0 0 5 5M12 5 7 10"
                />
              </svg>
            </AIInputButton>
          </AIInputToolbar>
        </AIInput>
        {attachedResourceIds.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
            {attachedResourceIds.map((id) => (
              <span
                key={id}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
              >
                <span className="whitespace-nowrap">{id}</span>
                <button
                  type="button"
                  onClick={() => setAttachedResourceIds((prev) => prev.filter((x) => x !== id))}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-zinc-200/70 dark:hover:bg-zinc-800"
                  aria-label="Remove"
                  title="Remove"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" className="h-3 w-3">
                    <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className={`inline-flex items-center rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 ${
              quickAction === "Batch XHS Posts" ? "ring-2 ring-zinc-900/10 dark:ring-white/10" : ""
            }`}
            onClick={() => setQuickAction((prev) => (prev === "Batch XHS Posts" ? null : "Batch XHS Posts"))}
          >
            Batch XHS Posts
          </button>
          <button
            type="button"
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 ${
              quickAction === "Design Image" ? "ring-2 ring-zinc-900/10 dark:ring-white/10" : ""
            }`}
            onClick={() => setQuickAction((prev) => (prev === "Design Image" ? null : "Design Image"))}
          >
            <span
              aria-hidden="true"
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[12px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            >
              🍌
            </span>
            <span className="whitespace-nowrap">Design Image</span>
          </button>
        </div>
      </div>
    </div>
  );
}
