import { getMongoDb } from '@/lib/mongodb';
import { getUserFromRequest } from '@/lib/supabaseAuthServer';

type PersonaDoc = {
  _id: string;
  userId: string;
  name: string;
  avatarUrl?: string | null;
  isPrivate?: boolean;
  attributes?: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export async function GET(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = await getMongoDb();
  const docs = await db
    .collection<PersonaDoc>('personas')
    .find({ userId: auth.user.id })
    .sort({ createdAt: 1 })
    .toArray();

  return Response.json(
    docs.map((d: PersonaDoc) => ({
      id: d._id,
      user_id: d.userId,
      name: d.name,
      avatar_url: d.avatarUrl ?? null,
      is_private: Boolean(d.isPrivate),
      attributes: d.attributes ?? null,
      created_at: d.createdAt.toISOString(),
      updated_at: d.updatedAt.toISOString(),
    }))
  );
}

export async function POST(req: Request) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const payload = (body ?? {}) as {
    id?: string;
    name?: string;
    avatar_url?: string | null;
    is_private?: boolean;
    attributes?: unknown;
  };

  const name = (payload.name ?? '').toString().trim();
  if (!name) {
    return Response.json({ error: 'Name is required' }, { status: 400 });
  }

  const id = (payload.id ?? crypto.randomUUID()).toString();

  const db = await getMongoDb();
  const now = new Date();

  await db.collection<PersonaDoc>('personas').updateOne(
    { _id: id, userId: auth.user.id },
    {
      $setOnInsert: {
        _id: id,
        userId: auth.user.id,
        createdAt: now,
      },
      $set: {
        name,
        avatarUrl: payload.avatar_url ?? null,
        isPrivate: true,
        attributes: payload.attributes ?? null,
        updatedAt: now,
      },
    },
    { upsert: true }
  );

  return Response.json({ id });
}
