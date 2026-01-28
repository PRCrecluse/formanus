import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-zinc-900 selection:bg-zinc-900 selection:text-white dark:bg-black dark:text-zinc-50 dark:selection:bg-white dark:selection:text-black">
      {/* Navbar */}
      <nav className="fixed top-0 z-50 flex w-full items-center justify-between border-b border-zinc-100 bg-white/80 px-6 py-4 backdrop-blur-md dark:border-zinc-800 dark:bg-black/80 lg:px-12">
        <Link href="/" className="flex items-center gap-2">
             <div className="relative h-8 w-8 overflow-hidden rounded-md flex items-center justify-center">
                 <Image src="/logo-dark-icon.png" alt="Persona AI" fill className="object-contain dark:hidden" />
                 <Image src="/logo-light-icon.png" alt="Persona AI" fill className="object-contain hidden dark:block" />
             </div>
             <span className="font-serif text-lg font-bold tracking-tight">Persona AI</span>
        </Link>
        
        <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-8 text-base font-bold text-zinc-900 dark:text-zinc-50 md:flex">
            <Link href="/pricing" className="hover:opacity-70 transition-opacity">Pricing</Link>
            <Link href="/use-cases" className="hover:opacity-70 transition-opacity">Use cases</Link>
            <div className="flex items-center gap-4">
                <Link href="/doc" className="hover:opacity-70 transition-opacity">Doc</Link>
                <Link href="/blog" className="hover:opacity-70 transition-opacity">Blog</Link>
            </div>
        </div>

        <div className="flex items-center gap-4">
          <Link href="/login" className="hidden text-sm font-medium hover:text-zinc-600 dark:hover:text-zinc-300 md:block">
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

      {/* Hero Section */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 pb-20 pt-32 text-center md:pt-40">
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h1 className="mx-auto max-w-5xl font-serif text-5xl font-bold tracking-tight sm:text-7xl">
            Turn your ideas into a viral star.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400 sm:text-xl">
            Persona AI is where your creativity meets intelligence. Build unique digital identities, automate your social presence, and scale your influence without the busywork.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
                href="/signup"
                className="rounded-lg bg-[#0070f3] px-8 py-3 text-base font-semibold text-white transition-all hover:bg-[#0060df] hover:shadow-lg"
            >
                Sign up
            </Link>
            <Link
                href="#"
                className="flex items-center gap-2 rounded-lg px-8 py-3 text-base font-semibold text-[#0070f3] transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20"
            >
                Request a demo <ArrowRight className="h-4 w-4" />
            </Link>
            </div>
        </div>

        {/* Hero Image / Illustration Placeholder */}
        <div className="mt-20 w-full max-w-5xl animate-in fade-in slide-in-from-bottom-8 delay-200 duration-700">
           <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
              <div className="absolute inset-0 flex items-center justify-center bg-[url('/grid.svg')] bg-center [mask-image:linear-gradient(180deg,white,rgba(255,255,255,0))]"></div>
               {/* Abstract representation of personas */}
               <div className="relative flex items-center justify-center gap-8">
                   <div className="h-32 w-32 rounded-full bg-gradient-to-tr from-blue-500 to-cyan-400 opacity-80 blur-2xl"></div>
                   <div className="h-40 w-40 rounded-full bg-gradient-to-tr from-purple-500 to-pink-400 opacity-80 blur-2xl"></div>
                   <div className="h-32 w-32 rounded-full bg-gradient-to-tr from-amber-500 to-orange-400 opacity-80 blur-2xl"></div>
                   
                   <div className="absolute z-10 flex gap-6">
                       <div className="h-24 w-24 rounded-full border-4 border-white bg-zinc-200 shadow-xl dark:border-zinc-800 dark:bg-zinc-700"></div>
                       <div className="h-32 w-32 -translate-y-4 rounded-full border-4 border-white bg-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-50">
                           <div className="flex h-full w-full items-center justify-center">
                               <Image src="/logo.png" alt="Logo" width={64} height={64} className="opacity-80" />
                           </div>
                       </div>
                       <div className="h-24 w-24 rounded-full border-4 border-white bg-zinc-200 shadow-xl dark:border-zinc-800 dark:bg-zinc-700"></div>
                   </div>
               </div>
           </div>
        </div>
      </main>

      <footer className="border-t border-zinc-100 bg-white py-12 dark:border-zinc-800 dark:bg-black">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-6 sm:flex-row lg:px-8">
          <p className="text-sm text-zinc-500">
            &copy; {new Date().getFullYear()} Persona AI Inc. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-zinc-500 sm:justify-end">
            <a
              href="https://www.vibepersona.top/privacy"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Privacy
            </a>
            <a
              href="https://www.vibepersona.top/terms"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Terms
            </a>
            <a
              href="mailto:prcrecluse@gmail.com"
              className="hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              Email
            </a>
            <a
              href="https://x.com/prcrecluse674?s=21"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              X
            </a>
            <a
              href="https://www.xiaohongshu.com/user/profile/5f12e5900000000001000726?xsec_token=YBTiJ3xUX_taGmQWkjyQMmwqK0nXIuH48YWcQ9DIxX_fI=&xsec_source=app_"
              target="_blank"
              rel="noreferrer"
              className="hover:text-zinc-900 dark:hover:text-zinc-50"
            >
              小红书
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
