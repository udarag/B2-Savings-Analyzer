'use client';

import { useEffect } from 'react';

const APP_TITLE = 'B2 Savings Analyzer';

export function useDocumentTitle(pageTitle?: string | null) {
  useEffect(() => {
    const trimmed = pageTitle?.trim();
    document.title = trimmed ? `${trimmed} | ${APP_TITLE}` : APP_TITLE;
  }, [pageTitle]);
}
