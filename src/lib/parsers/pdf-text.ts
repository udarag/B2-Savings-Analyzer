import { execSync } from 'child_process';
import { v4 as uuid } from 'uuid';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Extract layout-preserving text from a PDF via poppler's `pdftotext`. Extracted ONCE per upload
// and threaded through detection + the chosen parser, rather than re-shelling 2-3x (which tripled
// the transient-failure surface). A unique temp filename avoids collisions between concurrent
// uploads landing in the same millisecond.
export function extractPdfText(pdfBuffer: Buffer): string {
  const tmpPath = join(tmpdir(), `bill-${uuid()}.pdf`);
  try {
    writeFileSync(tmpPath, pdfBuffer);
    return execSync(`pdftotext -layout "${tmpPath}" -`, {
      maxBuffer: 50 * 1024 * 1024,
    }).toString('utf-8');
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}
