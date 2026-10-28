const PAGE_PATHS: Record<string, string[]> = {
  terms: ['/terms'],
  privacy: ['/privacy'],
  returns: ['/returns'],
  shipping: ['/shipping'],
  'laptop-banking-terms': ['/laptop-banking', '/laptop-banking/terms'],
  warranty: ['/warranty'],
};

export async function revalidateContent(paths: string[]): Promise<void> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;

  const url = process.env.FRONTEND_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) {
    console.error('Content revalidation skipped: FRONTEND_REVALIDATE_URL or REVALIDATE_SECRET is not set');
    return;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidate-secret': secret,
      },
      body: JSON.stringify({ paths: unique }),
    });
    if (!response.ok) {
      console.error('Content revalidation failed', response.status);
    }
  } catch (error) {
    console.error('Content revalidation failed', error);
  }
}

export function pathsForContentPage(slug: string): string[] {
  return PAGE_PATHS[slug] || [];
}
