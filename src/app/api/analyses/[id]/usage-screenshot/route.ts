import { NextResponse } from 'next/server';
import { getAnalysisMeta, uploadFile } from '@/lib/storage/storage';
import { getSessionUser } from '@/lib/auth/session';
import { storageErrorResponse } from '@/lib/api/route-helpers';

/**
 * Stub only — screenshot parsing is NOT implemented. This route accepts and stores the image
 * (so nothing the AE uploads is thrown away, in case a later phase wants to batch-process
 * previously-uploaded screenshots) and returns 501 so the client falls back to manual entry.
 *
 * Real extraction needs its own scoping conversation before this route does anything more: this
 * codebase has no existing LLM/vision integration, so wiring one up means a new provider choice,
 * a new API key/env var, a per-call cost model, and a security review for image-upload handling.
 * Do not add an LLM/vision call here without that conversation happening first.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userEmail = await getSessionUser();
  if (!userEmail) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const formData = await req.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const meta = await getAnalysisMeta(userEmail, id);
  if (!meta) {
    return NextResponse.json({ error: 'Analysis not found' }, { status: 404 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await uploadFile(userEmail, id, file.name, buffer, file.type);
  } catch (error) {
    return storageErrorResponse(error, `Failed to store usage screenshot for ${id}`);
  }

  return NextResponse.json(
    {
      status: 'not_implemented',
      message: "We can't automatically read usage screenshots yet — please enter the numbers below.",
    },
    { status: 501 },
  );
}
