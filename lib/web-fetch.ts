import * as cheerio from 'cheerio';

/**
 * Fetch and extract text content from a URL
 */
export async function fetchUrlContent(url: string): Promise<{
  success: boolean;
  content?: string;
  title?: string;
  error?: string;
}> {
  try {
    console.log(`Fetching URL: ${url}`);
    
    // Fetch the webpage
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      signal: AbortSignal.timeout(15000), // 15 second timeout
    });

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const html = await response.text();
    
    // Parse HTML with cheerio
    const $ = cheerio.load(html);
    
    // Remove script, style, and other non-content elements
    $('script, style, nav, footer, header, iframe, noscript').remove();
    
    // Extract title
    const title = $('title').text().trim() || 
                  $('meta[property="og:title"]').attr('content') || 
                  $('h1').first().text().trim();
    
    // Extract meta description
    const metaDescription = $('meta[name="description"]').attr('content') ||
                           $('meta[property="og:description"]').attr('content') ||
                           '';
    
    // Extract main content
    // Try to find main content areas first
    let mainContent = '';
    
    // Common content selectors
    const contentSelectors = [
      'main',
      'article',
      '[role="main"]',
      '.content',
      '#content',
      '.main-content',
      'body'
    ];
    
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        mainContent = element.text();
        break;
      }
    }
    
    // Clean up the text
    let cleanText = mainContent
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/\n+/g, '\n') // Replace multiple newlines with single newline
      .trim();
    
    // Limit content length (keep first 50k chars for context)
    if (cleanText.length > 50000) {
      cleanText = cleanText.substring(0, 50000) + '... [content truncated]';
    }
    
    // Build structured content
    const content = `
# ${title}

${metaDescription ? `**Description**: ${metaDescription}\n` : ''}
**URL**: ${url}

## Page Content:

${cleanText}
`.trim();

    console.log(`Successfully fetched ${url}: ${content.length} characters`);
    
    return {
      success: true,
      content,
      title
    };
    
  } catch (error) {
    console.error(`Error fetching URL ${url}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check if a URL is valid and accessible
 */
export function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
