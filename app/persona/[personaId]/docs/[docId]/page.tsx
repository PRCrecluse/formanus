"use client";

import { Suspense, use } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

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
  const boardHref = `/board?${new URLSearchParams({
    docId,
    personaId,
  }).toString()}`;

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-zinc-900">
      <header className="flex items-center justify-end border-b border-zinc-200 bg-white px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <Link
          href={boardHref}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          View in board
        </Link>
      </header>
      <main className="flex-1">
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
      </main>
    </div>
  );
}
