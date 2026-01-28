'use server';

import { createClient } from '@supabase/supabase-js';
import type { User } from '@supabase/supabase-js';

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function getUserFromRequest(req: Request): Promise<{
  user: User;
  accessToken: string;
} | null> {
  const header = req.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const accessToken = match[1]?.trim();
  if (!accessToken) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await supabase.auth.getUser(accessToken);
      if (error || !data.user) return null;
      return { user: data.user, accessToken };
    } catch {
      if (attempt === 0) {
        await sleep(200);
        continue;
      }
      return null;
    }
  }

  return null;
}
