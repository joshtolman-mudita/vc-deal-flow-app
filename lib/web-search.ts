/**
 * Web search using Serper API (Google search results)
 * Get your API key at: https://serper.dev/
 */

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  date?: string;
}

export interface SearchResponse {
  success: boolean;
  results?: SearchResult[];
  error?: string;
}

function normalizeToken(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function isAmbiguousCompanyName(companyName: string): boolean {
  const normalized = normalizeToken(companyName);
  if (!normalized) return true;
  const ambiguous = new Set([
    "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ]);
  return ambiguous.has(normalized) || normalized.length <= 3;
}

function containsCompanyName(text: string, companyName: string): boolean {
  const name = normalizeToken(companyName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!name) return false;
  return new RegExp(`\\b${name}\\b`, "i").test(text);
}

function isLikelyCompanySpecificResult(result: SearchResult, companyName: string, domain: string): boolean {
  const haystack = `${result.title || ""} ${result.snippet || ""}`.toLowerCase();
  const link = normalizeToken(result.link || "");
  const normalizedDomain = normalizeToken(domain);
  const hasName = containsCompanyName(haystack, companyName);
  const hasBusinessContext = /\b(company|startup|platform|software|saas|customers?|funding|series|founded|founder|product|team)\b/i.test(haystack);
  if (normalizedDomain && link.includes(normalizedDomain)) return true;
  if (isAmbiguousCompanyName(companyName)) {
    return hasName && hasBusinessContext;
  }
  return hasName || hasBusinessContext;
}

/**
 * Check if Serper API is configured
 */
export function isSearchConfigured(): boolean {
  return !!process.env.SERPER_API_KEY && process.env.SERPER_API_KEY !== 'your_serper_api_key_here';
}

/**
 * Search the web using Serper API
 */
export async function searchWeb(query: string, numResults: number = 5): Promise<SearchResponse> {
  if (!isSearchConfigured()) {
    console.log('Serper API not configured, skipping search');
    return {
      success: false,
      error: 'Serper API key not configured'
    };
  }

  try {
    console.log(`Searching web for: "${query}"`);
    
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': process.env.SERPER_API_KEY!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: query,
        num: numResults
      })
    });

    if (!response.ok) {
      return {
        success: false,
        error: `Serper API error: ${response.status} ${response.statusText}`
      };
    }

    const data = await response.json();
    
    const results: SearchResult[] = (data.organic || []).map((item: any) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      date: item.date
    }));

    console.log(`Found ${results.length} search results`);
    
    return {
      success: true,
      results
    };
    
  } catch (error) {
    console.error('Error searching web:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Perform multiple searches for a company and compile results
 */
export async function searchCompanyInformation(
  companyName: string,
  companyUrl?: string
): Promise<string> {
  const domain = (() => {
    if (!companyUrl) return '';
    try {
      const parsed = new URL(companyUrl.startsWith('http') ? companyUrl : `https://${companyUrl}`);
      return parsed.hostname.replace(/^www\./i, '');
    } catch {
      return '';
    }
  })();

  const searchQueries = [
    `"${companyName}" funding news ${new Date().getFullYear()}`,
    `"${companyName}" competitors market analysis`,
    `"${companyName}" product features customers`,
    `"${companyName}" TAM market size SAM SOM`,
    `"${companyName}" industry CAGR market growth rate`,
    domain ? `site:${domain} market size TAM CAGR` : "",
    `"${companyName}" total addressable market CAGR`
  ].filter(Boolean);

  const allResults: string[] = [];
  allResults.push(`# Web Search Results for ${companyName}\n`);
  allResults.push(`Search performed: ${new Date().toISOString()}\n`);

  for (const query of searchQueries) {
    const searchResponse = await searchWeb(query, 5);
    
    if (searchResponse.success && searchResponse.results) {
      const relevantResults = searchResponse.results.filter((result) =>
        isLikelyCompanySpecificResult(result, companyName, domain)
      );
      allResults.push(`\n## Search: "${query}"\n`);
      if (relevantResults.length === 0) {
        allResults.push(`No high-confidence company-specific results for this query.\n`);
      } else {
        relevantResults.forEach((result, index) => {
          allResults.push(`\n### Result ${index + 1}: ${result.title}`);
          allResults.push(`**URL**: ${result.link}`);
          if (result.date) {
            allResults.push(`**Date**: ${result.date}`);
          }
          allResults.push(`**Summary**: ${result.snippet}\n`);
        });
      }
    } else {
      allResults.push(`\n## Search: "${query}"\n`);
      allResults.push(`⚠️ Search failed: ${searchResponse.error}\n`);
    }
  }

  return allResults.join('\n');
}

/**
 * Format search results for AI consumption
 */
export function formatSearchResultsForAI(
  companyName: string,
  searchContent: string,
  websiteContent?: string
): string {
  return `
# Current Web Information for ${companyName}

⚠️ IMPORTANT: The information below is from RECENT web searches and website scraping (${new Date().toISOString().split('T')[0]}). This is CURRENT information about the company, not from training data.

${websiteContent ? `## Company Website Content\n\n${websiteContent}\n\n---\n` : ''}

${searchContent}

---

**Analysis Instructions**:
- Use this CURRENT information in your analysis
- This data is more recent than your training cutoff
- Pay special attention to recent funding, news, and market developments
- Cross-reference website content with search results for accuracy
`.trim();
}
