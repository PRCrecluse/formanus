import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";

type BlogPost = {
  title: string;
  slug: string;
  content: string;
  cover_image_url: string | null;
  published_at: string | null;
};

const manualPosts: BlogPost[] = [
  {
    title: "I'm building a manus for content creation",
    slug: "im-building-a-manus-for-content-creation",
    content:
      "I'm building a manus for content creation.\n\nI'm building vibepersona from my home in Hangzhou, China.\nBorn in 2006, I'm spending my winter break as a sophomore trying to carve a different path.",
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

async function fetchDbPostBySlug(slug: string): Promise<{ post: BlogPost | null; errorText: string | null }> {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").toString().trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").toString().trim();
  if (!supabaseUrl || !supabaseAnonKey) {
    return { post: null, errorText: null };
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
    .select("title,slug,content,cover_image_url,published_at")
    .eq("slug", slug)
    .eq("status", "published")
    .single();

  if (res.error) return { post: null, errorText: res.error.message };
  return { post: (res.data ?? null) as BlogPost | null, errorText: null };
}

function loadPostBySlug(slug: string) {
  return unstable_cache(
    async () => await fetchDbPostBySlug(slug),
    ["aipersona:blog:post:v1", slug],
    { revalidate: 60 }
  )();
}

export default async function BlogPostPage({ params }: { params: { slug?: string } }) {
  const slug = (params?.slug ?? "").toString().trim();
  const manual = manualPosts.find((p) => p.slug === slug);
  const { post: dbPost, errorText } = manual ? { post: null as BlogPost | null, errorText: null } : await loadPostBySlug(slug);
  const post = manual ?? dbPost;

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

      <main className="mx-auto w-full max-w-3xl px-6 pb-24 pt-28">
        <Link href="/blog" className="text-sm font-semibold text-zinc-600 hover:underline dark:text-zinc-300">
          ← Back to Blog
        </Link>

        {errorText && (
          <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {errorText}
          </div>
        )}

        {!errorText && post && (
          <article className="mt-8">
            <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {formatDate(post.published_at)}
            </div>
            <h1 className="mt-3 font-serif text-4xl font-bold tracking-tight">
              {post.title}
            </h1>
            {post.cover_image_url && (
              <div className="relative mt-6 aspect-[16/9] overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <Image
                  src={post.cover_image_url}
                  alt={post.title}
                  fill
                  className="object-cover"
                />
              </div>
            )}
            <div className="prose prose-zinc mt-8 max-w-none dark:prose-invert">
              <div className="whitespace-pre-wrap">{post.content}</div>
            </div>
          </article>
        )}

        {!errorText && !post && (
          <div className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
            Post not found.
          </div>
        )}
      </main>
    </div>
  );
}
