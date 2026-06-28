import { NextResponse } from 'next/server';
import { getStorageErrorDetails } from '@/lib/storage/storage';

/**
 * Map a thrown storage error to a safe JSON response. Transient B2/database
 * failures become a 503 the client can retry; anything else becomes a generic
 * 500 rather than leaking an uncaught stack. Use only around storage operations
 * — parse/validation failures should return their own 4xx instead.
 */
export function storageErrorResponse(error: unknown, logLabel: string): NextResponse {
  console.error(`${logLabel}:`, error);
  const details = getStorageErrorDetails(error);
  return NextResponse.json(
    { error: details.message, code: details.code },
    { status: details.status },
  );
}
