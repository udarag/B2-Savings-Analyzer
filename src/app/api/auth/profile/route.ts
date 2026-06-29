import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/session';
import { getStorageErrorDetails, getUserProfile, saveUserProfile } from '@/lib/storage/storage';
import type { UserProfile } from '@/lib/storage/storage';

/** Loads the signed-in AE's saved profile (display name / title) used to personalize generated reports. */
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
    // Storage being down should not block the app: return 200 with a soft profileUnavailable flag
    // so the UI degrades to defaults rather than treating it as an auth/validation failure.
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

/** Updates the signed-in AE's profile; merges the patch over existing values so omitted fields are preserved. */
export async function PATCH(req: Request) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized', profile: null }, { status: 401 });
  }

  const body = await req.json() as Partial<UserProfile>;

  try {
    // Read-modify-write: only fields present in the patch override stored values; the rest fall back
    // to what's already saved (displayName further falls back to '' since it's required).
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
