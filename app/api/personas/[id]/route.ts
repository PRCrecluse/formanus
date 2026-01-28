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

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = decodeURIComponent(rawId);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const payload = (body ?? {}) as {
    name?: string;
    avatar_url?: string | null;
    is_private?: boolean;
    attributes?: unknown;
  };

  const update: Partial<PersonaDoc> & { updatedAt: Date } = {
    updatedAt: new Date(),
    isPrivate: true,
  };

  if (payload.name !== undefined) {
    const nextName = payload.name.toString().trim();
    if (!nextName) {
      return Response.json({ error: 'Name is required' }, { status: 400 });
    }
    update.name = nextName;
  }
  if (payload.avatar_url !== undefined) {
    update.avatarUrl = payload.avatar_url ?? null;
  }
  if (payload.attributes !== undefined) {
    update.attributes = payload.attributes ?? null;
  }
  const db = await getMongoDb();
  const res = await db.collection<PersonaDoc>('personas').findOneAndUpdate(
    { _id: id, userId: auth.user.id },
    { $set: update },
    { returnDocument: 'after' }
  );

  const doc = res ?? null;
  if (!doc) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({
    id: doc._id,
    user_id: doc.userId,
    name: doc.name,
    avatar_url: doc.avatarUrl ?? null,
    is_private: Boolean(doc.isPrivate),
    attributes: doc.attributes ?? null,
    created_at: doc.createdAt.toISOString(),
    updated_at: doc.updatedAt.toISOString(),
  });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await getUserFromRequest(req);
  if (!auth) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: rawId } = await context.params;
  const id = decodeURIComponent(rawId);

  const db = await getMongoDb();
  const res = await db
    .collection<PersonaDoc>('personas')
    .deleteOne({ _id: id, userId: auth.user.id });

  if (!res.deletedCount) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json({ ok: true });
}
