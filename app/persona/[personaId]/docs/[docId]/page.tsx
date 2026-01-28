"use client";

import { Suspense, use } from "react";
import dynamic from "next/dynamic";

const DocEditor = dynamic(() => import("@/components/DocEditor"), {
  ssr: false,
  loading: () => (
    <div className="p-8 space-y-4 animate-pulse">
      <div className="h-8 w-64 rounded bg-zinc-100 dark:bg-zinc-800" />
      <div className="h-4 w-40 rounded bg-zinc-100 dark:bg-zinc-800" />
      <div className="h-[60vh] w-full rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
    </div>
  ),
});

export default function PersonaDocPage({
  params,
}: {
  params: Promise<{ personaId: string; docId: string }>;
}) {
  const unwrappedParams = use(params);
  const personaId = decodeURIComponent(unwrappedParams.personaId);
  const docId = decodeURIComponent(unwrappedParams.docId);
  
  return (
    <div className="min-h-screen">
      <Suspense
        fallback={
          <div className="p-8 space-y-4 animate-pulse">
            <div className="h-8 w-64 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-4 w-40 rounded bg-zinc-100 dark:bg-zinc-800" />
            <div className="h-[60vh] w-full rounded-2xl bg-zinc-100 dark:bg-zinc-800" />
          </div>
        }
      >
        <DocEditor personaId={personaId} docId={docId} />
      </Suspense>
    </div>
  );
}
