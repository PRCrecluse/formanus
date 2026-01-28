export const runtime = "nodejs";

function getHeader(headers: Headers, names: string[]) {
  for (const name of names) {
    const value = headers.get(name);
    if (value && value.trim()) return value.trim();
  }
  return "";
}

function getClientIp(headers: Headers) {
  const forwarded = getHeader(headers, ["x-forwarded-for"]);
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    getHeader(headers, ["x-real-ip", "cf-connecting-ip", "x-client-ip", "x-forwarded", "forwarded-for", "forwarded"]) || ""
  );
}

async function lookupCountryByIp(ip: string) {
  if (!ip) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);
  try {
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { country_code?: string | null };
    const code = (json?.country_code ?? "").toString().trim().toUpperCase();
    return code || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(req: Request) {
  const headers = req.headers;
  const countryHeader =
    getHeader(headers, ["x-vercel-ip-country"]) ||
    getHeader(headers, ["cf-ipcountry"]) ||
    getHeader(headers, ["x-country-code"]);
  if (countryHeader) {
    const code = countryHeader.toUpperCase();
    return Response.json({ country: code, isMainlandChina: code === "CN", source: "header" }, { status: 200 });
  }
  const ip = getClientIp(headers);
  const country = await lookupCountryByIp(ip);
  if (country) {
    return Response.json({ country, isMainlandChina: country === "CN", source: "ipapi" }, { status: 200 });
  }
  return Response.json({ country: null, isMainlandChina: false, source: "unknown" }, { status: 200 });
}
