'use client';

import { useEffect } from 'react';

const APP_TITLE = 'B2 Savings Analyzer';

/**
 * Sets the browser tab title to "<pageTitle> | B2 Savings Analyzer", or just the
 * app name when no page title is given (e.g. before an analysis name has loaded).
 */
export function useDocumentTitle(pageTitle?: string | null) {
  useEffect(() => {
    const trimmed = pageTitle?.trim();
    document.title = trimmed ? `${trimmed} | ${APP_TITLE}` : APP_TITLE;
  }, [pageTitle]);
}
