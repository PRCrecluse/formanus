import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";

type BlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string | null;
};

const manualPosts: BlogPost[] = [
  {
    id: "manual-im-building-a-manus",
    title: "I'm building a manus for content creation",
    slug: "im-building-a-manus-for-content-creation",
    excerpt:
      "I’m building vibepersona from my home in Hangzhou, China. Born in 2006, I’m spending my winter break as a sophomore trying to carve a different path.",
    cover_image_url: null,
    published_at: "2025-01-26T00:00:00.000Z",
  },
];

function formatDate(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

const loadPublishedDbPosts = unstable_cache(
  async (): Promise<{ dbPosts: BlogPost[]; errorText: string | null }> => {
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").toString().trim();
    const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").toString().trim();
    if (!supabaseUrl || !supabaseAnonKey) {
      return { dbPosts: [], errorText: null };
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const res = await supabase
      .from("blog_posts")
      .select("id,title,slug,excerpt,cover_image_url,published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(50);

    if (res.error) {
      return { dbPosts: [], errorText: res.error.message };
    }

    return { dbPosts: (res.data ?? []) as BlogPost[], errorText: null };
  },
  ["aipersona:blog:published_posts:v1"],
  { revalidate: 60 }
);

export default async function BlogIndexPage() {
  const { dbPosts, errorText } = await loadPublishedDbPosts();

  const posts = [...manualPosts, ...dbPosts].sort((a, b) => {
    const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
    const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
    return tb - ta;
  });

  const hero = posts[0];
  const rest = posts.slice(1);

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

      <main className="mx-auto w-full max-w-6xl px-6 pb-24 pt-28 lg:px-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="font-serif text-5xl font-bold tracking-tight sm:text-6xl">
              Blog
            </h1>
            <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
              Product updates, use cases, and best practices.
            </p>
          </div>
        </div>

        {errorText && (
          <div className="mt-8 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {errorText}
          </div>
        )}

        {!errorText && posts.length === 0 && (
          <div className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
            No published posts yet.
          </div>
        )}

        {!errorText && hero && (
          <Link
            href={`/blog/${hero.slug}`}
            className="mt-10 block overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          >
            <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
              <div className="p-6">
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  {formatDate(hero.published_at)}
                </div>
                <div className="mt-2 text-2xl font-semibold tracking-tight">
                  {hero.title}
                </div>
                {hero.excerpt && (
                  <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                    {hero.excerpt}
                  </div>
                )}
              </div>
              <div className="relative min-h-[180px] bg-zinc-100 dark:bg-zinc-900">
                {hero.cover_image_url ? (
                  <Image
                    src={hero.cover_image_url}
                    alt={hero.title}
                    fill
                    className="object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,112,243,0.25),transparent_55%)]" />
                )}
              </div>
            </div>
          </Link>
        )}

        {!errorText && rest.length > 0 && (
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rest.map((p) => (
              <Link
                key={p.id}
                href={`/blog/${p.slug}`}
                className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:bg-zinc-900"
              >
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                  {formatDate(p.published_at)}
                </div>
                <div className="mt-2 text-lg font-semibold tracking-tight group-hover:underline">
                  {p.title}
                </div>
                {p.excerpt && (
                  <div className="mt-2 line-clamp-3 text-sm text-zinc-600 dark:text-zinc-400">
                    {p.excerpt}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
