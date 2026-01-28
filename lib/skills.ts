export type WebSearchResult = { title: string; url: string; snippet: string };

function decodeHtmlEntities(input: string) {
  return input
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

function stripTags(input: string) {
  return input.replace(/<[^>]*>/g, " ");
}

async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const timeoutMs = init.timeoutMs ?? 12000;
  const controller = new AbortController();
  let timeoutTriggered = false;
  const startedAt = Date.now();
  const t = setTimeout(() => {
    timeoutTriggered = true;
    const elapsed = Date.now() - startedAt;
    const err = new Error(`Web search timeout after ${elapsed}ms: ${url}`);
    (err as { name?: string }).name = "AbortError";
    controller.abort(err);
  }, timeoutMs);
  try {
    const { timeoutMs: _t, ...rest } = init;
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (e) {
    const elapsed = Date.now() - startedAt;
    if (timeoutTriggered) {
      const err = new Error(`Web search timeout after ${elapsed}ms: ${url}`);
      (err as { name?: string }).name = "AbortError";
      throw err;
    }
    if (e instanceof Error && e.name === "AbortError") {
      const err = new Error(`Web search aborted after ${elapsed}ms: ${url}`);
      (err as { name?: string }).name = "AbortError";
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function parseDuckDuckGoLite(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const linkRes = [
    /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
    /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g,
  ];
  const snippetRes = [
    /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/,
    /<div[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/div>/,
  ];

  for (const linkRe of linkRes) {
    linkRe.lastIndex = 0;
    let m: RegExpExecArray | null = null;
    while ((m = linkRe.exec(html)) && results.length < limit) {
      const href = decodeHtmlEntities(m[1] ?? "").trim();
      const titleHtml = m[2] ?? "";
      const title = decodeHtmlEntities(stripTags(titleHtml).replace(/\s+/g, " ").trim());
      if (!href || !title) continue;
      if (!/^https?:\/\//i.test(href)) continue;
      const after = html.slice(m.index);
      let snippet = "";
      for (const snRe of snippetRes) {
        const sn = snRe.exec(after);
        if (sn?.[1]) {
          snippet = decodeHtmlEntities(stripTags((sn[1] ?? "") as string).replace(/\s+/g, " ").trim());
          break;
        }
      }
      results.push({ title, url: href, snippet });
    }
    if (results.length > 0) return results.slice(0, limit);
  }
  return results.slice(0, limit);
}

function parseDuckDuckGoHtml(html: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRes = [
    /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/,
    /<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/,
    /<span[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/span>/,
  ];

  let m: RegExpExecArray | null = null;
  while ((m = linkRe.exec(html)) && results.length < limit) {
    const href = decodeHtmlEntities(m[1] ?? "").trim();
    const titleHtml = m[2] ?? "";
    const title = decodeHtmlEntities(stripTags(titleHtml).replace(/\s+/g, " ").trim());
    if (!href || !title) continue;
    if (!/^https?:\/\//i.test(href)) continue;
    const after = html.slice(m.index);
    let snippet = "";
    for (const snRe of snippetRes) {
      const sn = snRe.exec(after);
      if (sn?.[1]) {
        snippet = decodeHtmlEntities(stripTags((sn[1] ?? "") as string).replace(/\s+/g, " ").trim());
        break;
      }
    }
    results.push({ title, url: href, snippet });
  }

  return results.slice(0, limit);
}

function parseDuckDuckGoInstantAnswer(json: unknown, limit: number): WebSearchResult[] {
  if (!json || typeof json !== "object") return [];
  const obj = json as { RelatedTopics?: unknown };
  const topics = Array.isArray(obj.RelatedTopics) ? obj.RelatedTopics : [];
  const results: WebSearchResult[] = [];

  const pushTopic = (t: unknown) => {
    if (!t || typeof t !== "object") return;
    const it = t as { FirstURL?: unknown; Text?: unknown };
    const url = typeof it.FirstURL === "string" ? it.FirstURL : "";
    const text = typeof it.Text === "string" ? it.Text : "";
    const title = text ? text.split(" - ")[0]!.trim() : "";
    const snippet = text ? text.trim() : "";
    if (!url || !title) return;
    results.push({ title, url, snippet });
  };

  for (const t of topics) {
    if (results.length >= limit) break;
    if (t && typeof t === "object" && "Topics" in t) {
      const nested = (t as { Topics?: unknown }).Topics;
      if (Array.isArray(nested)) {
        for (const nt of nested) {
          if (results.length >= limit) break;
          pushTopic(nt);
        }
      }
      continue;
    }
    pushTopic(t);
  }

  return results.slice(0, limit);
}

function coerceResults(items: Array<{ title?: string; url?: string; snippet?: string }>, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  for (const it of items) {
    if (results.length >= limit) break;
    const title = (it.title ?? "").toString().trim();
    const url = (it.url ?? "").toString().trim();
    const snippet = (it.snippet ?? "").toString().trim();
    if (!title || !url) continue;
    results.push({ title, url, snippet });
  }
  return results;
}

async function runSerperSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const key = (process.env.SERPER_API_KEY ?? "").toString().trim();
  if (!key) return [];
  const timeouts = [12000, 20000];
  for (let i = 0; i < timeouts.length; i++) {
    try {
      const res = await fetchWithTimeout("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": key,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ q: query, num: limit }),
        timeoutMs: timeouts[i],
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const detail = text.toString().trim();
        const msg = detail ? `Serper error (${res.status}): ${detail}` : `Serper error (${res.status})`;
        throw new Error(msg);
      }
      const data = (await res.json()) as unknown;
      if (!data || typeof data !== "object") return [];
      const organic = (data as { organic?: unknown }).organic;
      const items = Array.isArray(organic) ? organic : [];
      const mapped = items.map((it) => {
        const obj = it && typeof it === "object" ? (it as { title?: unknown; link?: unknown; snippet?: unknown }) : {};
        return {
          title: typeof obj.title === "string" ? obj.title : "",
          url: typeof obj.link === "string" ? obj.link : "",
          snippet: typeof obj.snippet === "string" ? obj.snippet : "",
        };
      });
      return coerceResults(mapped, limit);
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      if (i < timeouts.length - 1 && (msg.includes("aborted") || msg.includes("timeout"))) {
        continue;
      }
      throw e;
    }
  }
  return [];
}

async function runBraveSearch(query: string, limit: number): Promise<WebSearchResult[]> {
  const key = (process.env.BRAVE_SEARCH_API_KEY ?? "").toString().trim();
  if (!key) return [];
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.max(1, Math.min(10, limit))}`;
  const res = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": key,
    },
    timeoutMs: 10000,
  });
  if (!res.ok) {
    throw new Error(`Brave error (${res.status})`);
  }
  const data = (await res.json()) as unknown;
  if (!data || typeof data !== "object") return [];
  const web = (data as { web?: unknown }).web;
  const results = web && typeof web === "object" ? (web as { results?: unknown }).results : [];
  const items = Array.isArray(results) ? results : [];
  const mapped = items.map((it) => {
    const obj = it && typeof it === "object" ? (it as { title?: unknown; url?: unknown; description?: unknown }) : {};
    return {
      title: typeof obj.title === "string" ? obj.title : "",
      url: typeof obj.url === "string" ? obj.url : "",
      snippet: typeof obj.description === "string" ? obj.description : "",
    };
  });
  return coerceResults(mapped, limit);
}

export async function runWebSearch(query: string, limit = 5): Promise<WebSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const provider = (process.env.WEB_SEARCH_PROVIDER ?? "").toString().trim().toLowerCase();
  const providerIsSerper = provider === "serper";
  const providerIsBrave = provider === "brave";
  const serperKey = (process.env.SERPER_API_KEY ?? "").toString().trim();
  const useSerper = providerIsSerper || (!provider && serperKey.length > 0);
  const useBrave =
    providerIsBrave ||
    (!provider && !useSerper && (process.env.BRAVE_SEARCH_API_KEY ?? "").toString().trim().length > 0);

  if (useSerper) {
    try {
      const results = await runSerperSearch(q, limit);
      if (results.length > 0) return results;
    } catch (e) {
      if (providerIsSerper) throw e;
    }
  }

  if (useBrave) {
    try {
      const results = await runBraveSearch(q, limit);
      if (results.length > 0) return results;
    } catch (e) {
      if (providerIsBrave) throw e;
    }
  }

  const userAgent = "Mozilla/5.0";
  const headers = {
    "User-Agent": userAgent,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
  };

  const errors: unknown[] = [];

  const allowDuckDuckGoFallback = !useSerper && !useBrave;

  if (allowDuckDuckGoFallback) {
    const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
    try {
      const liteRes = await fetchWithTimeout(liteUrl, { method: "GET", headers, timeoutMs: 10000 });
      if (liteRes.ok) {
        const html = await liteRes.text();
        const results = parseDuckDuckGoLite(html, limit);
        if (results.length > 0) return results;
      }
    } catch (e) {
      errors.push(e);
    }

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
      const res = await fetchWithTimeout(url, { method: "GET", headers, timeoutMs: 10000 });
      if (res.ok) {
        const html = await res.text();
        const results = parseDuckDuckGoHtml(html, limit);
        if (results.length > 0) return results;
      }
    } catch (e) {
      errors.push(e);
    }

    try {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
      const res = await fetchWithTimeout(url, {
        method: "GET",
        headers: { "User-Agent": userAgent, Accept: "application/json" },
        timeoutMs: 10000,
      });
      if (res.ok) {
        const json = (await res.json()) as unknown;
        const results = parseDuckDuckGoInstantAnswer(json, limit);
        if (results.length > 0) return results;
      }
    } catch (e) {
      errors.push(e);
    }
  }

  const lastErr = errors[errors.length - 1];
  if (lastErr instanceof Error) {
    const msg = lastErr.message.toLowerCase();
    if (msg.includes("timeout") || msg.includes("fetch failed") || msg.includes("network") || msg.includes("aborted")) {
      throw lastErr;
    }
  }

  return [];
}

export function formatWebSearchForPrompt(results: WebSearchResult[]) {
  if (results.length === 0) return "";
  const lines = results.map((r, i) => {
    const parts = [`[${i + 1}] ${r.title}`, r.url, r.snippet].filter(Boolean);
    return parts.join("\n");
  });
  return lines.join("\n\n");
}
