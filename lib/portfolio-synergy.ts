import OpenAI from 'openai';
import { PortfolioSynergyResearch } from '@/types/diligence';
import { fetchUrlContent } from '@/lib/web-fetch';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MUDITA_PORTFOLIO_URL = 'https://muditavp.com/portfolio/#';
const MUDITA_PORTFOLIO_FALLBACK = `
Mudita Portfolio Snapshot (fallback):

- Amplify Publishing Group | Digital Media | Hybrid publisher serving thought leaders.
- BlastPoint | AI/ML | Customer AI for targeting and messaging.
- i-Genie.ai | Enterprise Software | Consumer insights AI from large-scale data signals.
- K1x | Enterprise Software | AI automation for K-1, K-3, and 990 workflows.
- Koda Health | Bio/HealthTech | Care alignment workflow platform in healthcare.
- Mav | AI/ML | AI lead engagement and qualification for insurance agents.
- Official AI | AI/ML | Voice and identity licensing for generative AI.
- Predict.law | AI/ML | Legal AI for case evaluation and negotiation outcomes.
- Qwoted | Digital Media | Journalist-expert matching platform.
- Trajektory | Enterprise Software | Sponsorship analytics and revenue platform.
- Aerovy | Enterprise Software | Connected hardware ecosystem software platform.
- Chatterworks | Enterprise Software | AI-driven recruiting engagement workflows.
- Curated for You | AI/ML | E-commerce personalization and intent layer.
- Honeycomb Credit | FinTech | Community investment and SMB funding platform.
- Juicer | Enterprise Software | Omnichannel revenue management and competitive intelligence.
- Laws of Motion | Enterprise Software | AI fit and sizing for apparel brands.
- Lunch Payments | FinTech | Flexible payment terms and invoice acceleration.
- Pavewise | Enterprise Software | AI production/weather tracking for construction.
- Polymer | Security | AI-driven data security and noise reduction.
- RiseKit | Enterprise Software | Employer-community talent sourcing workflows.
- Scorbit | AI/ML | Connected arcade competition platform.
- Screencastify | EdTech | Video platform for visual communication.
- Sign AI | AI/ML | Multimodal ASL model development.
- Trellis | Enterprise Software | AI automation for e-commerce advertising.
`.trim();

interface PortfolioSynergyInput {
  companyName: string;
  companyUrl?: string;
  companyDescription?: string;
  companyOneLiner?: string;
  industry?: string;
}

function hasMeaningfulCompanyContext(input: PortfolioSynergyInput): boolean {
  const fields = [input.companyDescription, input.companyOneLiner, input.industry, input.companyUrl]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  return fields.length > 0;
}

function looksLikeMissingCompanyContextSummary(summary: string): boolean {
  return /\b(lack of specific information|without knowing|insufficient information|not enough information|unknown company|unable to identify)\b/i.test(
    summary
  );
}

function buildContextAwareFallbackSummary(input: PortfolioSynergyInput): string {
  const snippets = [input.companyOneLiner, input.companyDescription, input.industry]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
    .join(' ');
  const compact = snippets.replace(/\s+/g, ' ').slice(0, 220);
  const contextLead = compact
    ? `Based on available company context (${compact}),`
    : 'Based on available company context,';
  return `${contextLead} no concrete overlap with Mudita portfolio companies has been validated yet. Potential adjacency appears plausible but needs clearer customer-segment and integration details to confirm actionable synergies.`;
}

export async function runPortfolioSynergyResearch(
  input: PortfolioSynergyInput
): Promise<PortfolioSynergyResearch> {
  const { companyName, companyUrl, companyDescription, companyOneLiner, industry } = input;

  let portfolioContent = '';
  let sourceUrl = MUDITA_PORTFOLIO_URL;
  const portfolioPage = await fetchUrlContent(MUDITA_PORTFOLIO_URL);
  if (portfolioPage.success && portfolioPage.content) {
    portfolioContent = portfolioPage.content.slice(0, 35000);
  } else {
    // Fallback for anti-bot / 403 scenarios so synergy research still runs.
    portfolioContent = MUDITA_PORTFOLIO_FALLBACK;
    sourceUrl = `${MUDITA_PORTFOLIO_URL} (fallback snapshot)`;
  }
  const prompt = `You are a VC diligence analyst.

Goal: evaluate synergy between "${companyName}" and Mudita Venture Partners portfolio companies.

Return strict JSON only:
{
  "synergyScore": 0,
  "summary": "",
  "matches": [
    {
      "companyName": "",
      "rationale": "",
      "synergyType": "similar_space"
    }
  ]
}

Allowed synergyType values only:
- similar_space
- similar_customer
- complementary_offering

Scoring intent:
- Higher when there are multiple concrete and plausible collaborations or GTM/customer adjacency opportunities.
- Moderate when overlaps are thematic but not clearly actionable.
- Low when little credible overlap exists.

Rules:
- Use only portfolio companies present in provided portfolio source.
- Do not invent portfolio companies.
- Keep rationale specific and practical.
- Return up to 8 best matches.
- Keep summary concise (2-4 sentences).

Target company context:
- Company: ${companyName}
- URL: ${companyUrl || 'unknown'}
- One-liner: ${companyOneLiner || 'unknown'}
- Description: ${companyDescription || 'unknown'}
- Industry: ${industry || 'unknown'}

Mudita portfolio source (${MUDITA_PORTFOLIO_URL}):
${portfolioContent}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are precise and conservative. Return JSON only. No markdown. No prose outside JSON.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No portfolio synergy response from OpenAI');
  }

  const parsed = JSON.parse(content);
  const validType = (value: string): value is 'similar_space' | 'similar_customer' | 'complementary_offering' =>
    value === 'similar_space' || value === 'similar_customer' || value === 'complementary_offering';

  const matches = Array.isArray(parsed.matches)
    ? parsed.matches
        .map((m: any) => {
          const company = typeof m?.companyName === 'string' ? m.companyName.trim() : '';
          const rationale = typeof m?.rationale === 'string' ? m.rationale.trim() : '';
          const synergyTypeRaw = typeof m?.synergyType === 'string' ? m.synergyType.trim() : '';
          const synergyType = validType(synergyTypeRaw) ? synergyTypeRaw : undefined;
          if (!company || !rationale || !synergyType) return null;
          return {
            companyName: company,
            rationale,
            synergyType,
          };
        })
        .filter(
          (m: any): m is { companyName: string; rationale: string; synergyType: 'similar_space' | 'similar_customer' | 'complementary_offering' } =>
            Boolean(m)
        )
        .slice(0, 8)
    : [];

  return {
    summary: (() => {
      const candidate =
        typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
          ? parsed.summary.trim()
          : 'No reliable portfolio-synergy summary could be generated.';
      if (hasMeaningfulCompanyContext(input) && looksLikeMissingCompanyContextSummary(candidate)) {
        return buildContextAwareFallbackSummary(input);
      }
      return candidate;
    })(),
    synergyScore: Number.isFinite(Number(parsed.synergyScore))
      ? Math.max(0, Math.min(100, Math.round(Number(parsed.synergyScore))))
      : undefined,
    matches,
    analyzedAt: new Date().toISOString(),
    sourceUrl,
  };
}
