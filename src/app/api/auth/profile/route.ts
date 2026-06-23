import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getStorageErrorDetails, getUserProfile, saveUserProfile } from '@/lib/storage/storage';
import type { UserProfile } from '@/lib/storage/storage';

export async function GET() {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized', profile: null }, { status: 401 });
  }

  let profile: UserProfile | null;
  try {
    profile = await getUserProfile(userEmail);
  } catch (error) {
    console.error('Failed to load user profile:', error);
    const details = getStorageErrorDetails(error);
    return NextResponse.json({
      profile: null,
      profileUnavailable: true,
      warning: details.message,
      code: details.code,
    });
  }

  return NextResponse.json({ profile });
}

export async function PATCH(req: Request) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized', profile: null }, { status: 401 });
  }

  const body = await req.json() as Partial<UserProfile>;

  try {
    const existing = await getUserProfile(userEmail);
    const updated: UserProfile = {
      displayName: body.displayName ?? existing?.displayName ?? '',
      title: body.title ?? existing?.title,
    };

    await saveUserProfile(userEmail, updated);
    return NextResponse.json({ profile: updated });
  } catch (error) {
    console.error('Failed to save user profile:', error);
    const details = getStorageErrorDetails(error);
    return NextResponse.json(
      { error: details.message, code: details.code, profile: null },
      { status: details.status },
    );
  }
}
