import OpenAI from 'openai';
import { ProblemNecessityResearch } from '@/types/diligence';
import { fetchUrlContent, isValidUrl } from '@/lib/web-fetch';
import { isSearchConfigured, searchCompanyInformation } from '@/lib/web-search';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ProblemNecessityInput {
  companyName: string;
  companyUrl?: string;
  companyDescription?: string;
  companyOneLiner?: string;
  industry?: string;
}

export async function runProblemNecessityResearch(
  input: ProblemNecessityInput
): Promise<ProblemNecessityResearch> {
  const { companyName, companyUrl, companyDescription, companyOneLiner, industry } = input;

  let websiteContent = '';
  if (companyUrl && isValidUrl(companyUrl)) {
    const website = await fetchUrlContent(companyUrl);
    if (website.success && website.content) {
      websiteContent = website.content.slice(0, 14000);
    }
  }

  let searchContent = '';
  if (isSearchConfigured()) {
    searchContent = await searchCompanyInformation(companyName, companyUrl);
  }

  const prompt = `Analyze how necessary the problem is that this company solves.

Use the rubric:
- vitamin: nice-to-have
- advil: must-have painkiller
- vaccine: mandated / existentially required

Return strict JSON only in this exact shape:
{
  "necessityScore": 0,
  "classification": "vitamin",
  "summary": "",
  "topSignals": [
    { "label": "", "evidence": "", "strength": "medium" }
  ],
  "counterSignals": [
    { "label": "", "evidence": "", "strength": "low" }
  ]
}

Rules:
- Do not invent evidence.
- Use concrete signals where possible: cost of inaction, urgency, frequency, mandate/compliance, budget ownership, operational pain.
- topSignals and counterSignals: up to 6 each.
- classification must be exactly one of: vitamin, advil, vaccine.
- Keep summary concise (2-4 sentences).

Company context:
- Name: ${companyName}
- URL: ${companyUrl || 'unknown'}
- One-liner: ${companyOneLiner || 'unknown'}
- Description: ${companyDescription || 'unknown'}
- Industry: ${industry || 'unknown'}

Website content:
${websiteContent || 'Not available'}

Web research:
${searchContent || 'Not available'}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are a disciplined VC diligence analyst. Return strict JSON only and be conservative when evidence quality is weak.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No problem necessity response from OpenAI');
  }

  const parsed = JSON.parse(content);
  const normalizeStrength = (value: any): 'low' | 'medium' | 'high' | undefined => {
    const v = String(value || '').toLowerCase().trim();
    if (v === 'low' || v === 'medium' || v === 'high') return v;
    return undefined;
  };
  const normalizeSignals = (signals: any): Array<{ label: string; evidence: string; strength?: 'low' | 'medium' | 'high' }> =>
    Array.isArray(signals)
      ? signals
          .map((s: any) => ({
            label: typeof s?.label === 'string' ? s.label.trim() : '',
            evidence: typeof s?.evidence === 'string' ? s.evidence.trim() : '',
            strength: normalizeStrength(s?.strength),
          }))
          .filter((s) => s.label && s.evidence)
          .slice(0, 6)
      : [];

  const rawClassification = String(parsed.classification || '').toLowerCase().trim();
  const classification =
    rawClassification === 'vitamin' || rawClassification === 'advil' || rawClassification === 'vaccine'
      ? rawClassification
      : undefined;

  return {
    summary:
      typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
        ? parsed.summary.trim()
        : 'No reliable problem-necessity summary could be generated.',
    necessityScore: Number.isFinite(Number(parsed.necessityScore))
      ? Math.max(0, Math.min(100, Math.round(Number(parsed.necessityScore))))
      : undefined,
    classification,
    topSignals: normalizeSignals(parsed.topSignals),
    counterSignals: normalizeSignals(parsed.counterSignals),
    analyzedAt: new Date().toISOString(),
  };
}
