import { NextResponse } from "next/server";
import OpenAI from "openai";
import { buildDiligenceLookupMaps, resolveDiligenceContextForDeal } from "@/lib/matching-diligence";

// Data quality scoring function
function assessDataQuality(deal: any, partner: any): { 
  dealQuality: number; 
  partnerQuality: number; 
  dealWarnings: string[];
  partnerWarnings: string[];
} {
  const dealWarnings: string[] = [];
  const partnerWarnings: string[] = [];
  let dealQuality = 0;
  let partnerQuality = 0;

  // Deal data quality (out of 100)
  if (deal.description && deal.description.length > 50) dealQuality += 30;
  else if (deal.description && deal.description.length > 0) dealQuality += 15;
  else dealWarnings.push("Missing deal description");

  if (deal.industry && deal.industry !== "N/A") dealQuality += 25;
  else dealWarnings.push("Missing industry information");

  if (deal.amount && deal.amount !== "N/A") dealQuality += 20;
  else dealWarnings.push("Missing deal amount");

  if (deal.stageName && deal.stageName !== "N/A") dealQuality += 15;
  else dealWarnings.push("Missing stage information");

  if (deal.dealTerms && deal.dealTerms.length > 20) dealQuality += 10;

  // Partner data quality (out of 100)
  if (partner.thesis && partner.thesis.length > 50) partnerQuality += 40;
  else if (partner.thesis && partner.thesis.length > 0) partnerQuality += 20;
  else partnerWarnings.push("Missing investment thesis");

  if (partner.investmentSpace && partner.investmentSpace !== "N/A") partnerQuality += 25;
  else partnerWarnings.push("Missing investment space");

  if (partner.investmentStage && partner.investmentStage !== "N/A") partnerQuality += 20;
  else partnerWarnings.push("Missing investment stage");

  if (partner.checkSize && partner.checkSize !== "N/A") partnerQuality += 15;
  else partnerWarnings.push("Missing check size");

  return { dealQuality, partnerQuality, dealWarnings, partnerWarnings };
}

export async function POST(request: Request) {
  try {
    // Check for API key
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY not found in environment variables");
      return NextResponse.json(
        { error: "OpenAI API key not configured" },
        { status: 500 }
      );
    }

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const { 
      partner, 
      deals, 
      customGuidance, 
      minMatchScore,
      scoringWeights = { industry: 30, thesis: 30, stage: 25, checkSize: 15 },
      checkSizeFilterStrictness = 25,
      minDataQuality = 30,
    } = await request.json();

    if (!partner || !deals || deals.length === 0) {
      return NextResponse.json(
        { error: "Partner and deals are required" },
        { status: 400 }
      );
    }

    console.log(`\n=== MATCHING DEALS FOR: ${partner.name} ===`);
    console.log(`Against ${deals.length} deals`);
    const diligenceLookup = await buildDiligenceLookupMaps();

    // Assess partner data quality
    const partnerDataQuality = assessDataQuality({ description: "", industry: "", amount: "", stageName: "" }, partner);
    console.log(`Partner data quality: ${partnerDataQuality.partnerQuality}%`);
    if (partnerDataQuality.partnerWarnings.length > 0) {
      console.log(`⚠️  Partner data warnings: ${partnerDataQuality.partnerWarnings.join(", ")}`);
    }

    // Level 1: Configurable Hard Filters (Quick elimination of obvious mismatches)
    const candidateDeals = deals.filter((deal: any) => {
      // Parse deal amount
      const dealAmount = parseFloat(deal.amount.replace(/[$,]/g, "")) || 0;
      
      // Parse VC's check size range
      let minCheck = 0;
      let maxCheck = Infinity;
      
      if (partner.checkSize.includes("Less than")) {
        maxCheck = 250000;
      } else if (partner.checkSize.includes("Between $250K and $1M")) {
        minCheck = 250000;
        maxCheck = 1000000;
      } else if (partner.checkSize.includes("Between $1M and $2M")) {
        minCheck = 1000000;
        maxCheck = 2000000;
      } else if (partner.checkSize.includes("Over $2M")) {
        minCheck = 2000000;
      }

      // Apply configurable check size filter strictness
      const strictnessMultiplier = 1 - (checkSizeFilterStrictness / 100);
      const upperMultiplier = 1 + (checkSizeFilterStrictness / 100);
      
      if (dealAmount > 0 && (dealAmount < minCheck * strictnessMultiplier || dealAmount > maxCheck * upperMultiplier)) {
        console.log(`  ❌ Filtered out ${deal.name}: Check size mismatch (deal: $${dealAmount.toLocaleString()}, VC range: $${minCheck.toLocaleString()}-$${maxCheck === Infinity ? "∞" : maxCheck.toLocaleString()}, strictness: ${checkSizeFilterStrictness}%)`);
        return false;
      }

      // Apply data quality filter
      const quality = assessDataQuality(deal, partner);
      if (quality.dealQuality < minDataQuality) {
        console.log(`  ❌ Filtered out ${deal.name}: Data quality too low (${quality.dealQuality}% < ${minDataQuality}%)`);
        return false;
      }

      return true; // Pass to AI evaluation
    });

    console.log(`After hard filters: ${candidateDeals.length} candidates`);

    // Level 2: AI-Powered Multi-Factor Evaluation (limit to 50 deals for cost)
    const matches = await Promise.all(
      candidateDeals.slice(0, 50).map(async (deal: any) => {
        try {
          // Assess data quality for this pair
          const quality = assessDataQuality(deal, partner);
          const diligenceContext = resolveDiligenceContextForDeal(deal, diligenceLookup);
          
          const prompt = `You are an expert VC matching analyst. Evaluate this deal against this VC partner using a structured, multi-factor approach.

═══ VC PARTNER INFORMATION ═══
Name: ${partner.name}
Type: ${partner.type}
Investment Thesis: ${partner.thesis || "⚠️ NOT PROVIDED - This significantly limits matching accuracy"}
Check Size: ${partner.checkSize}
Investment Stage: ${partner.investmentStage}${partner.investmentStage === "N/A" ? " ⚠️ MISSING" : ""}
Investment Space: ${partner.investmentSpace}${partner.investmentSpace === "N/A" ? " ⚠️ MISSING" : ""}
Regions: ${partner.regions}

═══ DEAL INFORMATION ═══
Name: ${deal.name}
Industry: ${deal.industry}${deal.industry === "N/A" ? " ⚠️ MISSING" : ""}
Description: ${deal.description || "⚠️ NOT PROVIDED - This limits matching accuracy"}
Stage: ${deal.stageName || deal.stage}
Amount: ${deal.amount}
Deal Terms: ${deal.dealTerms || "Not provided"}

═══ DILIGENCE CONTEXT (if available) ═══
${diligenceContext ? `
Linked Diligence Record: ${diligenceContext.diligenceId}
Diligence Score: ${diligenceContext.score ?? "N/A"}/100
Diligence Data Quality: ${diligenceContext.dataQuality ?? "N/A"}/100
Diligence Industry: ${diligenceContext.industry || "N/A"}
Recommendation: ${diligenceContext.recommendation || "N/A"}
Founder Intake Industry/Sector: ${diligenceContext.hubspotCompany?.industrySector || "N/A"}
Founder Intake Funding Stage: ${diligenceContext.hubspotCompany?.fundingStage || "N/A"}
Founder Intake Funding Amount: ${diligenceContext.hubspotCompany?.fundingAmount || "N/A"}
Founder Intake TAM: ${diligenceContext.hubspotCompany?.tamRange || "N/A"}
Founder Intake Runway: ${diligenceContext.hubspotCompany?.currentRunway || "N/A"}
Founder Intake Product Type: ${diligenceContext.hubspotCompany?.productCategorization || "N/A"}
What is exciting:
${diligenceContext.thesis?.exciting?.length ? diligenceContext.thesis.exciting.map((item) => `- ${item}`).join("\n") : "- N/A"}
What is concerning:
${diligenceContext.thesis?.concerning?.length ? diligenceContext.thesis.concerning.map((item) => `- ${item}`).join("\n") : "- N/A"}
Ideal customer: ${diligenceContext.thesis?.idealCustomer || "N/A"}
` : "No linked diligence context was found for this deal. Use only the deal and partner data above."}

═══ DATA QUALITY ASSESSMENT ═══
Deal Data Quality: ${quality.dealQuality}%${quality.dealWarnings.length > 0 ? ` (⚠️ ${quality.dealWarnings.join(", ")})` : ""}
Partner Data Quality: ${quality.partnerQuality}%${quality.partnerWarnings.length > 0 ? ` (⚠️ ${quality.partnerWarnings.join(", ")})` : ""}

═══ EVALUATION INSTRUCTIONS ═══

Evaluate using WEIGHTED FACTORS (weights are configurable):
1. **INDUSTRY ALIGNMENT (${scoringWeights.industry}% weight)**: How well does the deal's industry match the VC's investment space?
   - Exact match (AI/ML ↔ Artificial Intelligence): 90-100 points
   - Strong semantic match (Fintech ↔ Payment Software): 70-85 points  
   - Adjacent/related (Enterprise SaaS ↔ B2B Software): 50-70 points
   - Weak connection (Healthcare ↔ General B2B): 30-50 points
   - Poor match: 0-30 points

2. **THESIS ALIGNMENT (${scoringWeights.thesis}% weight)**: How well does the deal align with the VC's stated investment thesis?
   - If thesis is missing, base this ONLY on investment space alignment
   - Look for specific keywords, focus areas, and strategic interests
   - Consider examples of past investments mentioned in thesis

3. **STAGE ALIGNMENT (${scoringWeights.stage}% weight)**: Does the deal stage match VC's preferred stage?
   - Exact match: 90-100 points
   - Adjacent stage: 60-80 points
   - Stage mismatch but flexible wording: 40-60 points
   - Clear mismatch: 0-30 points

4. **CHECK SIZE FIT (${scoringWeights.checkSize}% weight)**: Deal amount within VC's check size range?
   - Deal passed pre-filter, so should be reasonable
   - Rate based on how well it fits within their sweet spot

═══ SCORING APPROACH ═══
- Calculate weighted sub-scores for each factor
- If diligence context is present, use it to refine thesis and industry alignment judgments.
- Weigh documented concerns from diligence when assessing risk and potential dealbreakers.
- Identify DEALBREAKERS (automatic low score): 
  * "Only invests in healthcare" but deal is fintech
  * "Series A+ only" but deal is Pre-Seed
  * Geographic restrictions not met
- Be CONSERVATIVE: It's better to miss a match than recommend a poor one
- Scores 80-100: Excellent match
- Scores 60-79: Good match  
- Scores 40-59: Possible match, significant concerns
- Scores 0-39: Poor match

${customGuidance ? `═══ CUSTOM MATCHING GUIDANCE ═══
${customGuidance}
` : ""}
═══ RESPONSE FORMAT ═══
Respond ONLY with valid JSON (no markdown, no code blocks):
{
  "score": <number 0-100>,
  "industryScore": <number 0-100>,
  "thesisScore": <number 0-100>,
  "stageScore": <number 0-100>,
  "checkSizeScore": <number 0-100>,
  "reasoning": "<2-3 sentences explaining the overall match>",
  "strengths": ["<specific strength 1>", "<specific strength 2>"],
  "concerns": ["<specific concern 1>"] or [],
  "dealbreakers": ["<critical mismatch>"] or []
}`;

          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.2, // Lower temperature for more consistent scoring
          });

          const result = JSON.parse(completion.choices[0].message.content || "{}");

          // Use quality data already assessed above (line 139)
          const dataQualityWarnings: string[] = [];
          
          if (quality.dealQuality < 50) {
            dataQualityWarnings.push("Limited deal data may affect match accuracy");
          }
          if (quality.partnerQuality < 50) {
            dataQualityWarnings.push("Limited VC data may affect match accuracy");
          }

          return {
            dealId: deal.id,
            dealName: deal.name,
            dealStage: deal.stageName || deal.stage,
            dealIndustry: deal.industry,
            dealAmount: deal.amount,
            score: result.score || 0,
            reasoning: result.reasoning || "",
            strengths: result.strengths || [],
            concerns: [...(result.concerns || []), ...dataQualityWarnings],
            dealbreakers: result.dealbreakers || [],
            // Include sub-scores for transparency
            industryScore: result.industryScore || null,
            thesisScore: result.thesisScore || null,
            stageScore: result.stageScore || null,
            checkSizeScore: result.checkSizeScore || null,
            dataQuality: {
              deal: quality.dealQuality,
              partner: quality.partnerQuality,
            },
            diligenceEnriched: Boolean(diligenceContext),
          };
        } catch (error) {
          console.error(`Error matching ${deal.name}:`, error);
          return {
            dealId: deal.id,
            dealName: deal.name,
            dealStage: deal.stageName || deal.stage,
            dealIndustry: deal.industry,
            dealAmount: deal.amount,
            score: 0,
            reasoning: "Error during matching - please try again",
            strengths: [],
            concerns: ["Failed to analyze match"],
            dealbreakers: [],
            diligenceEnriched: false,
          };
        }
      })
    );

    // Sort by score (highest first) and filter out low scores + dealbreakers
    const minScore = minMatchScore || 50;
    const goodMatches = matches
      .filter((m) => {
        // Filter out dealbreakers
        if (m.dealbreakers && m.dealbreakers.length > 0) {
          console.log(`  ❌ Filtered out ${m.dealName}: Dealbreakers found - ${m.dealbreakers.join(", ")}`);
          return false;
        }
        // Filter by minimum score
        return m.score >= minScore;
      })
      .sort((a, b) => b.score - a.score);

    console.log(`Found ${goodMatches.length} good matches (score >= ${minScore})`);
    console.log("=== END MATCHING ===\n");

    // Prepare data quality summary
    const avgPartnerQuality = partnerDataQuality.partnerQuality;
    const avgDealQuality = candidateDeals.length > 0 
      ? candidateDeals.reduce((sum: number, d: any) => {
          const q = assessDataQuality(d, partner);
          return sum + q.dealQuality;
        }, 0) / candidateDeals.length
      : 0;

    return NextResponse.json({
      matches: goodMatches,
      totalEvaluated: candidateDeals.length,
      totalMatches: goodMatches.length,
      dataQuality: {
        partner: avgPartnerQuality,
        deals: Math.round(avgDealQuality),
        warnings: partnerDataQuality.partnerWarnings,
        recommendation: avgPartnerQuality < 50 || avgDealQuality < 50 
          ? "Consider adding more detail to deal descriptions and VC investment thesis for better matches"
          : "Data quality is good"
      }
    });
  } catch (error: any) {
    console.error("Error in matching:", error);
    return NextResponse.json(
      { error: error.message || "Failed to match deals" },
      { status: 500 }
    );
  }
}

