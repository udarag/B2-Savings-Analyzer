import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth/session';
import { getUserProfile, saveUserProfile } from '@/lib/storage/storage';
import type { UserProfile } from '@/lib/storage/storage';

export async function GET() {
  const userEmail = await requireUser();
  const profile = await getUserProfile(userEmail);
  return NextResponse.json({ profile });
}

export async function PATCH(req: Request) {
  const userEmail = await requireUser();
  const body = await req.json() as Partial<UserProfile>;

  const existing = await getUserProfile(userEmail);
  const updated: UserProfile = {
    displayName: body.displayName ?? existing?.displayName ?? '',
    title: body.title ?? existing?.title,
  };

  await saveUserProfile(userEmail, updated);
  return NextResponse.json({ profile: updated });
}
