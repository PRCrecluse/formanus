import { createClient } from '@supabase/supabase-js';
import { getMongoDb } from '@/lib/mongodb';
import { getUserFromRequest } from '@/lib/supabaseAuthServer';

type SupabasePersonaRow = {
  id: string;
  user_id: string;
  name: string | null;
  avatar_url?: string | null;
  attributes?: unknown;
  created_at?: string | null;
  updated_at?: string | null;
};

type PersonaDoc = {
  _id: string;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  attributes?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export async function POST(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return Response.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const supabase = createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase
    .from('personas')
    .select('*')
    .eq('user_id', auth.user.id)
    .order('created_at', { ascending: true });

  if (error) {
    return Response.json(
      { error: 'Failed to load personas from Supabase', detail: error.message },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as SupabasePersonaRow[];
  if (rows.length === 0) {
    return Response.json({ inserted: 0, updated: 0, total: 0 });
  }

  const db = await getMongoDb();
  const col = db.collection<PersonaDoc>('personas');

  const ops = rows.map((row) => {
    const createdAt = row.created_at ? new Date(row.created_at) : new Date();
    const updatedAt = row.updated_at
      ? new Date(row.updated_at)
      : row.created_at
        ? new Date(row.created_at)
        : new Date();
    const name = (row.name ?? 'Untitled Persona').toString();

    return {
      updateOne: {
        filter: { _id: row.id, userId: auth.user.id },
        update: {
          $setOnInsert: {
            _id: row.id,
            userId: auth.user.id,
            createdAt,
          },
          $set: {
            name,
            avatarUrl: row.avatar_url ?? null,
            attributes: row.attributes ?? null,
            updatedAt,
          },
        },
        upsert: true,
      },
    };
  });

  const result = await col.bulkWrite(ops, { ordered: false });

  return Response.json({
    inserted: result.upsertedCount ?? 0,
    updated: result.modifiedCount ?? 0,
    total: rows.length,
  });
}
