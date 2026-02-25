import OpenAI from 'openai';
import { Founder, HubSpotCompanyData, HubSpotContactData, TeamResearch } from '@/types/diligence';
import { fetchUrlContent, isValidUrl } from '@/lib/web-fetch';
import { isSearchConfigured, searchCompanyInformation, searchWeb } from '@/lib/web-search';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface TeamResearchInput {
  companyName: string;
  companyUrl?: string;
  companyDescription?: string;
  existingFounders?: Founder[];
  hubspotCompanyData?: HubSpotCompanyData | null;
  hubspotContacts?: HubSpotContactData[];
  documentContext?: string;
}

function uniqueFounderCandidates(
  existingFounders?: Founder[],
  hubspotContacts?: HubSpotContactData[]
): Array<{ name: string; title?: string; linkedinUrl?: string; background?: string }> {
  const map = new Map<string, { name: string; title?: string; linkedinUrl?: string; background?: string }>();

  for (const founder of existingFounders || []) {
    const key = founder.name.trim().toLowerCase();
    if (!key) continue;
    map.set(key, {
      name: founder.name.trim(),
      title: founder.title,
      linkedinUrl: founder.linkedinUrl,
      background: founder.experienceSummary,
    });
  }

  for (const contact of hubspotContacts || []) {
    const name = (contact.fullName || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || '').trim();
    const key = name.toLowerCase();
    if (!key) continue;
    const existing = map.get(key);
    map.set(key, {
      name,
      title: existing?.title || contact.title,
      linkedinUrl: existing?.linkedinUrl || contact.linkedinUrl,
      background: existing?.background || contact.background,
    });
  }

  return Array.from(map.values()).slice(0, 8);
}

function normalizeFounderLinkedInUrl(value?: string): string | undefined {
  const trimmed = String(value || '').trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed) || /^linkedin\.com\//i.test(trimmed) || /^linkedin\.com$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return undefined;
}

function inferFounderSignalsFromText(rawText?: string): {
  hasPriorExit?: boolean;
  hasBeenCEO?: boolean;
  hasBeenCTO?: boolean;
} {
  const text = String(rawText || '').toLowerCase();
  if (!text) return {};
  const hasPriorExit = /\b(exit|acqui(?:red|sition)|sold\s+to|went\s+public|ipo|listed|successful\s+public\s+listing)\b/i.test(text);
  const hasBeenCEO = /\b(prior|former|ex|previous|second[-\s]?time).{0,20}\bceo\b|\bceo at\b|\bfounder\s*(?:&|and)\s*ceo\b/i.test(text);
  const hasBeenCTO = /\b(prior|former|ex|previous).{0,20}\bcto\b|\bcto at\b|\bfounder\s*(?:&|and)\s*cto\b/i.test(text);
  return { hasPriorExit, hasBeenCEO, hasBeenCTO };
}

function extractFounderContextFromDocuments(documentContext: string | undefined, founderName: string): string {
  const text = String(documentContext || '').replace(/\s+/g, ' ');
  const name = String(founderName || '').trim();
  if (!text || !name) return '';
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`(.{0,220}${escapedName}.{0,260})`, 'i'));
  return String(match?.[1] || '').trim();
}

function extractRoleHistoryFromText(rawText?: string): string[] {
  const text = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const patterns = [
    /\b(founder|co[-\s]?founder|ceo|cto|vp|head|director|principal|lead|engineer|architect)\b\s+(?:at|@)\s+([A-Z][A-Za-z0-9&.\- ]{1,60})/gi,
    /\b([A-Z][A-Za-z0-9&.\- ]{1,60})\s+(?:-|,)?\s*(ceo|cto|founder|co[-\s]?founder|vp|head|director|principal|lead|engineer|architect)\b/gi,
  ];
  const entries: string[] = [];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(text)) !== null) {
      const roleFirst = /^(founder|co[-\s]?founder|ceo|cto|vp|head|director|principal|lead|engineer|architect)$/i.test(match[1] || '');
      const role = roleFirst ? match[1] : match[2];
      const company = roleFirst ? match[2] : match[1];
      const cleanedRole = String(role || '').replace(/\s+/g, ' ').trim();
      const cleanedCompany = String(company || '').replace(/\s+/g, ' ').trim();
      if (!cleanedRole || !cleanedCompany) continue;
      if (/^(linkedin|profile|experience|background)$/i.test(cleanedCompany)) continue;
      entries.push(`${cleanedRole} at ${cleanedCompany}`);
    }
  }
  return Array.from(new Set(entries)).slice(0, 4);
}

async function buildFounderEvidence(
  founder: { name: string; title?: string; linkedinUrl?: string; background?: string },
  companyName: string
): Promise<string> {
  const lines: string[] = [];
  lines.push(`Founder candidate: ${founder.name}${founder.title ? ` (${founder.title})` : ''}`);
  if (founder.background) {
    lines.push(`CRM background: ${founder.background}`);
  }

  if (founder.linkedinUrl && isValidUrl(founder.linkedinUrl)) {
    lines.push(`LinkedIn URL: ${founder.linkedinUrl}`);
    try {
      const profileFetch = await fetchUrlContent(founder.linkedinUrl);
      if (profileFetch.success && profileFetch.content) {
        const snippet = profileFetch.content.replace(/\s+/g, ' ').slice(0, 800);
        lines.push(`LinkedIn page extract: ${snippet}`);
      }
    } catch {
      // Ignore LinkedIn fetch failures and rely on search snippets.
    }
  }

  if (!isSearchConfigured()) {
    lines.push('Web search unavailable (SERPER not configured).');
    return lines.join('\n');
  }

  const queries = [
    `"${founder.name}" "${companyName}" LinkedIn`,
    `"${founder.name}" founder exit acquisition`,
    `"${founder.name}" CEO OR CTO experience`,
  ];

  for (const query of queries) {
    const res = await searchWeb(query, 3);
    if (!res.success || !res.results || res.results.length === 0) {
      lines.push(`Search (${query}): no reliable results`);
      continue;
    }
    lines.push(`Search (${query}):`);
    for (const r of res.results.slice(0, 3)) {
      lines.push(`- ${r.title} | ${r.link} | ${r.snippet}`);
    }
  }

  return lines.join('\n');
}

export async function runTeamResearch(input: TeamResearchInput): Promise<TeamResearch> {
  const { companyName, companyUrl, companyDescription, existingFounders, hubspotCompanyData, hubspotContacts, documentContext } = input;

  let websiteContent = '';
  if (companyUrl && isValidUrl(companyUrl)) {
    const website = await fetchUrlContent(companyUrl);
    if (website.success && website.content) {
      websiteContent = website.content.slice(0, 12000);
    }
  }

  let searchContent = '';
  if (isSearchConfigured()) {
    searchContent = await searchCompanyInformation(companyName, companyUrl);
  }

  const existingFounderText =
    (existingFounders || []).length > 0
      ? existingFounders!
          .map((f) => `- ${f.name}${f.title ? ` (${f.title})` : ''}${f.linkedinUrl ? ` | ${f.linkedinUrl}` : ''}`)
          .join('\n')
      : 'None provided';

  const hubspotContactsText =
    (hubspotContacts || []).length > 0
      ? (hubspotContacts || [])
          .map((c) =>
            `- ${c.fullName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown'}${
              c.title ? ` (${c.title})` : ''
            }${c.linkedinUrl ? ` | LinkedIn: ${c.linkedinUrl}` : ''}${c.background ? ` | Background: ${c.background}` : ''}`
          )
          .join('\n')
      : 'No associated contacts from HubSpot';
  const founderCandidates = uniqueFounderCandidates(existingFounders, hubspotContacts);
  const founderEvidence = founderCandidates.length
    ? await Promise.all(founderCandidates.map((f) => buildFounderEvidence(f, companyName)))
    : [];

  const prompt = `Research the founding team for "${companyName}"${companyUrl ? ` (${companyUrl})` : ''}.

Return strict JSON only in this exact shape:
{
  "teamScore": 0,
  "summary": "",
  "founders": [
    {
      "name": "",
      "title": "",
      "linkedinUrl": "",
      "hasPriorExit": false,
      "priorExits": [""],
      "hasBeenCEO": false,
      "hasBeenCTO": false,
      "experienceSummary": "",
      "confidence": 0
    }
  ]
}

Scoring intent for teamScore:
- Higher when leadership has directly relevant prior founder/operator history.
- Strong positive for specific, verifiable exits.
- Positive if CEO has been CEO before, CTO has been CTO before.
- Conservative when information is sparse or unverifiable.

Rules:
- Do not invent people, exits, or titles.
- If uncertain, set confidence lower and leave fields empty/false.
- LinkedIn URLs should only be included when reasonably confident.
- priorExits should name specific companies/outcomes when available.
- Keep summary concise (2-4 sentences), evidence-based.
- Prioritize associated HubSpot contacts when identifying likely founders/leadership.
- For each founder, estimate "fitness to lead this company now" from role-history relevance, execution track record, and prior outcomes.

Existing founders from record:
${existingFounderText}

HubSpot company context:
- Name: ${hubspotCompanyData?.name || 'unknown'}
- Description: ${hubspotCompanyData?.description || 'unknown'}
- Industry: ${hubspotCompanyData?.industrySector || hubspotCompanyData?.industry || 'unknown'}
- LinkedIn: ${hubspotCompanyData?.linkedinUrl || 'unknown'}

Associated HubSpot contacts (high-priority founder signals):
${hubspotContactsText}

Per-founder evidence pack:
${founderEvidence.length > 0 ? founderEvidence.join('\n\n---\n\n') : 'No founder candidates available for deeper evidence lookup'}

Company description:
${companyDescription || 'Not provided'}

Website content:
${websiteContent || 'Not available'}

Web research:
${searchContent || 'Not available'}

Founder-relevant excerpts from uploaded documents:
${String(documentContext || '').trim() || 'Not available'}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are a diligence analyst focused on founder backgrounds. Return strict JSON only and stay conservative when evidence is weak.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No team research response from OpenAI');
  }

  const parsed = JSON.parse(content);
  const founderCandidatesByName = new Map<string, { name: string; title?: string; linkedinUrl?: string; background?: string }>();
  for (const candidate of founderCandidates) {
    founderCandidatesByName.set(candidate.name.trim().toLowerCase(), candidate);
  }
  const founders: Founder[] = Array.isArray(parsed.founders)
    ? parsed.founders
        .map((f: any) => {
          const name = typeof f?.name === 'string' ? f.name.trim() : '';
          if (!name) return null;
          const candidate = founderCandidatesByName.get(name.toLowerCase());
          const parsedSummary = typeof f?.experienceSummary === 'string' ? f.experienceSummary.trim() || undefined : undefined;
          const candidateSummary = candidate?.background?.trim() || undefined;
          const documentSummary = extractFounderContextFromDocuments(documentContext, name);
          const combinedSummary = [parsedSummary, candidateSummary, documentSummary].filter(Boolean).join(' | ');
          const inferredSignals = inferFounderSignalsFromText(combinedSummary);
          const roleHistory = extractRoleHistoryFromText(combinedSummary);
          const roleHistorySummary =
            roleHistory.length > 0 ? `Role history: ${roleHistory.join('; ')}.` : '';
          return {
            name,
            title: (typeof f?.title === 'string' ? f.title.trim() : '') || candidate?.title || undefined,
            linkedinUrl:
              normalizeFounderLinkedInUrl(typeof f?.linkedinUrl === 'string' ? f.linkedinUrl : undefined) ||
              normalizeFounderLinkedInUrl(candidate?.linkedinUrl),
            hasPriorExit: Boolean(f?.hasPriorExit || inferredSignals.hasPriorExit),
            priorExits: Array.isArray(f?.priorExits)
              ? f.priorExits.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 6)
              : undefined,
            hasBeenCEO: Boolean(f?.hasBeenCEO || inferredSignals.hasBeenCEO),
            hasBeenCTO: Boolean(f?.hasBeenCTO || inferredSignals.hasBeenCTO),
            experienceSummary: [combinedSummary, roleHistorySummary].filter(Boolean).join(' | ') || undefined,
            confidence:
              Number.isFinite(Number(f?.confidence)) ? Math.max(0, Math.min(100, Math.round(Number(f.confidence)))) : undefined,
          } as Founder;
        })
        .filter((f: Founder | null): f is Founder => Boolean(f?.name))
    : [];

  return {
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : 'No reliable founder research summary could be generated.',
    teamScore: Number.isFinite(Number(parsed.teamScore))
      ? Math.max(0, Math.min(100, Math.round(Number(parsed.teamScore))))
      : undefined,
    founders,
    analyzedAt: new Date().toISOString(),
  };
}
