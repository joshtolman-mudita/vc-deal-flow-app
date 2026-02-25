import * as cheerio from 'cheerio';
import { fetchUrlContent } from '@/lib/web-fetch';

type ExternalLinkIngestResult = {
  success: boolean;
  extractedText?: string;
  resolvedUrl?: string;
  error?: string;
  status?: 'ingested' | 'email_required' | 'failed';
};

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function normalizeLinkUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function isDocSendUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.endsWith('docsend.com');
  } catch {
    return false;
  }
}

function looksLikeEmailGate(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('docsend') &&
    (lower.includes('enter your email') ||
      lower.includes('email address') ||
      lower.includes('requires your email') ||
      lower.includes('continue to document'))
  );
}

const DOCSEND_ERROR_PATTERNS: RegExp[] = [
  /content unavailable/i,
  /this content is no longer available/i,
  /there was an error loading part of this content/i,
  /please enable cookies then reload the page/i,
  /if you see this error again/i,
];

function normalizeWhitespace(input: string): string {
  return String(input || '').replace(/\s+/g, ' ').trim();
}

function looksLikeBrokenDocSendContent(text: string): boolean {
  const normalized = normalizeWhitespace(text).toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 180) return true;
  const hits = DOCSEND_ERROR_PATTERNS.reduce((count, pattern) => (pattern.test(normalized) ? count + 1 : count), 0);
  return hits >= 1;
}

export function isLowQualityExtractedLinkContent(text: unknown): boolean {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return true;
  if (/^external document link:\s*https?:\/\//i.test(normalized)) return true;
  if (looksLikeBrokenDocSendContent(normalized)) return true;
  if (/\b(docsend privacy policy|powered by docsend|please enable cookies)\b/i.test(normalized)) return true;
  return false;
}

async function fetchDocSendViaJina(url: string): Promise<ExternalLinkIngestResult> {
  const mirrorUrl = `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`;
  const response = await fetch(mirrorUrl, {
    method: 'GET',
    headers: DEFAULT_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    return {
      success: false,
      status: 'failed',
      error: `DocSend mirror fetch failed: HTTP ${response.status}`,
    };
  }
  const text = normalizeWhitespace(await response.text());
  if (!text || looksLikeBrokenDocSendContent(text)) {
    return {
      success: false,
      status: 'failed',
      error: 'DocSend content appears unavailable from mirror fetch',
    };
  }
  const clipped = text.length > 50000 ? `${text.slice(0, 50000)}... [content truncated]` : text;
  return {
    success: true,
    status: 'ingested',
    resolvedUrl: url,
    extractedText: `
# DocSend
**URL**: ${url}

## Extracted Content
${clipped}
    `.trim(),
  };
}

function extractDocSendPageNumbers(html: string): number[] {
  const matches = Array.from(html.matchAll(/\/page_data\/(\d+)/gi));
  const nums = Array.from(new Set(matches.map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 0)));
  return nums.sort((a, b) => a - b).slice(0, 120);
}

function stripHtmlToText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, footer, header, noscript, iframe').remove();
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function collectJsonTextSignals(value: unknown, bucket: string[] = []): string[] {
  if (!value) return bucket;
  if (typeof value === 'string') {
    const text = normalizeWhitespace(value);
    if (text.length >= 20) bucket.push(text);
    return bucket;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonTextSignals(item, bucket);
    return bucket;
  }
  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (/(text|content|title|caption|ocr|transcript|speaker)/i.test(key)) {
        collectJsonTextSignals(val, bucket);
      } else if (typeof val === 'object') {
        collectJsonTextSignals(val, bucket);
      }
    }
  }
  return bucket;
}

async function fetchDocSendPageDataText(url: string, initialHtml: string, cookieHeader?: string): Promise<string> {
  const pageNumbers = extractDocSendPageNumbers(initialHtml);
  if (pageNumbers.length === 0) return '';
  const pageChunks: string[] = [];
  for (const page of pageNumbers) {
    const pageUrl = `${url.replace(/\/+$/, '')}/page_data/${page}`;
    try {
      const response = await fetch(pageUrl, {
        method: 'GET',
        headers: {
          ...DEFAULT_HEADERS,
          Referer: url,
          'X-Requested-With': 'XMLHttpRequest',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) continue;
      const body = await response.text();
      if (!body) continue;
      let extracted = '';
      try {
        const parsed = JSON.parse(body);
        const signals = collectJsonTextSignals(parsed, []);
        extracted = Array.from(new Set(signals)).join(' ');
      } catch {
        extracted = stripHtmlToText(body);
      }
      const normalized = normalizeWhitespace(extracted);
      if (!normalized || looksLikeBrokenDocSendContent(normalized)) continue;
      pageChunks.push(`[Page ${page}] ${normalized}`);
    } catch {
      // Best effort; continue other pages.
    }
  }
  return pageChunks.join('\n\n').trim();
}

function extractReadableTextFromHtml(url: string, html: string): string {
  const $ = cheerio.load(html);
  const title =
    $('title').text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    'External Document';
  const description =
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    '';

  $('script, style, nav, footer, header, noscript, iframe').remove();

  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const cleaned = bodyText.length > 50000 ? `${bodyText.slice(0, 50000)}... [content truncated]` : bodyText;

  return `
# ${title}
${description ? `\n**Description**: ${description}` : ''}
**URL**: ${url}

## Extracted Content
${cleaned || '[No readable body text found]'}
  `.trim();
}

async function fetchDocSendContent(url: string, accessEmail?: string): Promise<ExternalLinkIngestResult> {
  const initial = await fetch(url, {
    method: 'GET',
    headers: DEFAULT_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });

  if (!initial.ok) {
    return { success: false, status: 'failed', error: `DocSend fetch failed: HTTP ${initial.status}` };
  }

  const initialHtml = await initial.text();
  const gated = looksLikeEmailGate(initialHtml);
  const sessionCookies = initial.headers.get('set-cookie') || '';

  if (gated && accessEmail) {
    const postBodies = [
      new URLSearchParams({ email: accessEmail }),
      new URLSearchParams({ emailAddress: accessEmail }),
      new URLSearchParams({ visitor_email: accessEmail }),
    ];

    for (const body of postBodies) {
      try {
        const posted = await fetch(url, {
          method: 'POST',
          headers: {
            ...DEFAULT_HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: url,
            ...(sessionCookies ? { Cookie: sessionCookies } : {}),
          },
          body: body.toString(),
          redirect: 'follow',
          signal: AbortSignal.timeout(20000),
        });

        if (!posted.ok) continue;
        const postedHtml = await posted.text();
        if (!looksLikeEmailGate(postedHtml)) {
          return {
            success: true,
            status: 'ingested',
            resolvedUrl: posted.url || url,
            extractedText: extractReadableTextFromHtml(posted.url || url, postedHtml),
          };
        }
      } catch {
        // Try next payload shape.
      }
    }
  }

  if (gated && !accessEmail) {
    return {
      success: false,
      status: 'email_required',
      error: 'DocSend link appears email-gated. Provide an access email to attempt ingestion.',
    };
  }

  // Try first-class per-page extraction path used by DocSend viewer.
  const pageDataText = await fetchDocSendPageDataText(initial.url || url, initialHtml, sessionCookies);
  if (pageDataText && !looksLikeBrokenDocSendContent(pageDataText)) {
    const clipped = pageDataText.length > 50000 ? `${pageDataText.slice(0, 50000)}... [content truncated]` : pageDataText;
    return {
      success: true,
      status: 'ingested',
      resolvedUrl: initial.url || url,
      extractedText: `
# DocSend
**URL**: ${initial.url || url}

## Extracted Content
${clipped}
      `.trim(),
    };
  }

  // Either not gated or we could not bypass gate - keep best-effort extraction.
  const extracted = extractReadableTextFromHtml(initial.url || url, initialHtml);
  if (!looksLikeBrokenDocSendContent(extracted)) {
    return {
      success: true,
      status: 'ingested',
      resolvedUrl: initial.url || url,
      extractedText: extracted,
    };
  }

  // Retry with a mirror fetch that can resolve JS-heavy pages.
  const mirror = await fetchDocSendViaJina(initial.url || url);
  if (mirror.success && mirror.extractedText) {
    return mirror;
  }

  return {
    success: false,
    status: gated ? 'email_required' : 'failed',
    resolvedUrl: initial.url || url,
    error:
      mirror.error ||
      (gated
        ? 'DocSend link appears gated or inaccessible. Provide access email or a direct downloadable deck URL.'
        : 'DocSend page rendered an unavailable/error view instead of document content.'),
  };
}

export async function ingestExternalLink(rawUrl: string, accessEmail?: string): Promise<ExternalLinkIngestResult> {
  const normalizedUrl = normalizeLinkUrl(rawUrl);
  if (!normalizedUrl) {
    return { success: false, status: 'failed', error: 'Empty external URL' };
  }

  if (isDocSendUrl(normalizedUrl)) {
    return fetchDocSendContent(normalizedUrl, accessEmail?.trim() || undefined);
  }

  const fetched = await fetchUrlContent(normalizedUrl);
  if (!fetched.success || !fetched.content) {
    return {
      success: false,
      status: 'failed',
      resolvedUrl: normalizedUrl,
      error: fetched.error || 'Failed to fetch external URL',
    };
  }
  return {
    success: true,
    status: 'ingested',
    resolvedUrl: normalizedUrl,
    extractedText: fetched.content,
  };
}
