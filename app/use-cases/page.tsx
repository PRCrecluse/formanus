import Image from "next/image";
import Link from "next/link";

export default function UseCasesPage() {
  return (
    <div className="min-h-screen bg-white text-zinc-900 dark:bg-black dark:text-zinc-50">
      <nav className="fixed top-0 z-50 flex w-full items-center justify-between border-b border-zinc-100 bg-white/80 px-6 py-4 backdrop-blur-md dark:border-zinc-800 dark:bg-black/80 lg:px-12">
        <Link href="/landing" className="flex items-center gap-2">
          <div className="relative h-8 w-8 overflow-hidden rounded-md">
            <Image
              src="/logo-dark-icon.png"
              alt="Persona AI"
              fill
              sizes="32px"
              className="object-contain dark:hidden"
            />
            <Image
              src="/logo-light-icon.png"
              alt="Persona AI"
              fill
              sizes="32px"
              className="hidden object-contain dark:block"
            />
          </div>
          <span className="font-serif text-lg font-bold tracking-tight">
            Persona AI
          </span>
        </Link>

        <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-8 text-base font-bold text-zinc-900 dark:text-zinc-50 md:flex">
          <Link href="/pricing" className="transition-opacity hover:opacity-70">
            Pricing
          </Link>
          <Link href="/use-cases" className="transition-opacity hover:opacity-70">
            Use cases
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/doc" className="transition-opacity hover:opacity-70">
              Doc
            </Link>
            <Link href="/blog" className="transition-opacity hover:opacity-70">
              Blog
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="hidden text-sm font-medium hover:text-zinc-600 dark:hover:text-zinc-300 md:block"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-lg bg-[#0070f3] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#0060df]"
          >
            Sign up
          </Link>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-5xl px-6 pb-24 pt-28 lg:px-12">
        <h1 className="font-serif text-5xl font-bold tracking-tight sm:text-6xl">
          Use cases
        </h1>
        <p className="mt-4 max-w-2xl text-zinc-600 dark:text-zinc-400">
          这里将展示 Persona AI 的典型使用场景（后续补充内容）。
        </p>
      </main>
    </div>
  );
}
