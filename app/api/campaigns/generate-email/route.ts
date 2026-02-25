import { NextResponse } from "next/server";
import OpenAI from "openai";
import { Deal, CompanyData } from "@/types";
import hubspotClient from "@/lib/hubspot";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Properties to fetch from the company record
const COMPANY_PROPERTIES = [
  "name",
  "domain",
  "industry",
  "city",
  "state",
  "country",
  "founded_year",
  "num_employees",
  "linkedin_company_page",
  "description",
  "website",
  "annualrevenue",
  "numberofemployees",
  "phone",
  "type", // Company type to check if Portfolio Member
];

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not found in environment variables");
    return NextResponse.json(
      { error: "OpenAI API key not configured." },
      { status: 500 }
    );
  }

  if (!process.env.HUBSPOT_ACCESS_TOKEN) {
    console.error("HUBSPOT_ACCESS_TOKEN not found in environment variables");
    return NextResponse.json(
      { error: "HubSpot access token not configured." },
      { status: 500 }
    );
  }

  console.log('\n🚀 Starting email generation...');
  console.log('📋 Required HubSpot scopes: crm.objects.deals.read, crm.objects.companies.read, crm.associations.deals.read');

  try {
    const { dealIds, customGuidance }: { dealIds: string[]; customGuidance?: string } = await req.json();

    if (!dealIds || dealIds.length === 0) {
      return NextResponse.json(
        { error: "No deal IDs provided." },
        { status: 400 }
      );
    }

    console.log(`Generating email content for ${dealIds.length} deals...`);

    // First, fetch pipeline/stage metadata to map IDs to names
    const pipelinesResponse = await hubspotClient.crm.pipelines.pipelinesApi.getAll("deals");
    const stageMap = new Map();
    pipelinesResponse.results.forEach((pipeline: any) => {
      pipeline.stages?.forEach((stage: any) => {
        stageMap.set(stage.id, stage.label);
      });
    });

    // Fetch deals with full data including associations
    const dealDataPromises = dealIds.map(async (dealId) => {
      try {
        console.log(`\n🔍 Fetching deal: ${dealId}`);
        
        // Fetch deal data with associations
        const deal = await hubspotClient.crm.deals.basicApi.getById(
          dealId,
          [
            "dealname",
            "amount",
            "dealstage",
            "description",
            "industry_sector",
            "hs_next_step",
            "deal_terms",
          ],
          undefined,
          ["companies"] // Request company associations
        );

        console.log(`   ✅ Deal: ${deal.properties.dealname}`);
        
        let companyData: CompanyData | null = null;

        // Check if deal has company associations
        if (deal.associations && deal.associations.companies) {
          const companyAssociations = deal.associations.companies.results;
          console.log(`   Found ${companyAssociations?.length || 0} company associations`);
          
          if (companyAssociations && companyAssociations.length > 0) {
            const companyId = companyAssociations[0].id;
            console.log(`   ✅ Company ID: ${companyId}`);
            
            try {
              const company = await hubspotClient.crm.companies.basicApi.getById(
                companyId,
                COMPANY_PROPERTIES
              );
              
              const props = company.properties as any;
              companyData = {
                id: company.id,
                name: props.name || deal.properties.dealname,
                ...props,
              };
              
              console.log(`   ✅ Company Name: ${props.name}`);
              console.log(`   ✅ Company Type: ${props.type || 'NOT SET'}`);
            } catch (companyError: any) {
              console.error(`   ❌ Error fetching company details:`, companyError.message);
            }
          } else {
            console.log(`   ⚠️ No company associations in response`);
          }
        } else {
          console.log(`   ⚠️ No associations object in deal response`);
        }

        return {
          deal: deal.properties,
          company: companyData,
        };
      } catch (error) {
        console.error(`Error fetching deal ${dealId}:`, error);
        return null;
      }
    });

    const dealsWithCompanyData = (await Promise.all(dealDataPromises)).filter(
      Boolean
    ) as { deal: any; company: CompanyData | null }[];

    // Generate email content for each deal
    const emailContentPromises = dealsWithCompanyData.map(async ({ deal, company }) => {
      // Map deal stage ID to human-readable name
      const dealStageId = deal.dealstage || "";
      const dealStageName = stageMap.get(dealStageId) || dealStageId;
      
      // Detect if this is a completed investment by checking company type
      const companyType = (company?.type || "").toLowerCase().trim();
      const isPortfolioMember = companyType.includes("portfolio") || 
                               companyType.includes("member") ||
                               companyType === "portfolio member";
      
      // Also check deal stage NAME (not ID)
      const dealStageLower = dealStageName.toLowerCase().trim();
      const dealStageIndicatesInvestment = dealStageLower.includes("close win") || 
                                          dealStageLower.includes("deploy") ||
                                          dealStageLower.includes("won") ||
                                          dealStageLower.includes("closed");
      
      // If company type is "Portfolio Member" OR deal is closed/won, we've invested
      const isCompletedInvestment = isPortfolioMember || dealStageIndicatesInvestment;
      
      console.log(`\n=== INVESTMENT DETECTION: ${deal.dealname} ===`);
      console.log(`Company Type Raw: "${company?.type}"`);
      console.log(`Company Type (processed): "${companyType}"`);
      console.log(`Is Portfolio Member: ${isPortfolioMember}`);
      console.log(`Deal Stage ID: "${dealStageId}"`);
      console.log(`Deal Stage NAME: "${dealStageName}"`);
      console.log(`Deal Stage (processed): "${dealStageLower}"`);
      console.log(`Deal Stage Indicates Investment: ${dealStageIndicatesInvestment}`);
      console.log(`🎯 FINAL DECISION - Is Completed Investment: ${isCompletedInvestment}`);
      console.log(`=======================================\n`);
      
      const prompt = `You are an expert venture capital analyst writing an engaging, concise email about a startup ${isCompletedInvestment ? "portfolio company WHERE WE HAVE ALREADY INVESTED" : "investment opportunity we are considering"}.

**CRITICAL INSTRUCTION - READ CAREFULLY:**
${isCompletedInvestment ? `
🚨 THIS IS A PORTFOLIO COMPANY - WE HAVE ALREADY MADE THIS INVESTMENT 🚨

You MUST write about this as a COMPLETED investment that has ALREADY HAPPENED.

REQUIRED LANGUAGE (use phrases like these):
- "We invested in [Company Name]..."
- "Since our investment..."
- "We backed [Company Name]..."
- "We deployed $X..."
- "[Company Name] is a portfolio company..."
- "As one of our portfolio companies..."

FORBIDDEN LANGUAGE (NEVER use these):
- "We're evaluating..."
- "We're considering..."
- "This is an opportunity..."
- "We're excited about the potential..."
- "We're looking at..."
- Any future or conditional tense about the investment itself

This is NOT a potential investment - it is ALREADY DONE.
` : `
This is a POTENTIAL opportunity we are considering.

Use present/future tense:
- "We're evaluating..."
- "We're considering..."
- "This opportunity..."
`}**

**Deal Information:**
- Company Name: ${deal.dealname || "N/A"}
- Deal Amount: ${deal.amount ? `$${parseFloat(deal.amount).toLocaleString()}` : "N/A"}
- Industry: ${deal.industry_sector || "N/A"}
- Deal Stage: ${dealStageName || "N/A"} ${isCompletedInvestment ? "(COMPLETED INVESTMENT)" : "(IN PROGRESS)"}
- Deal Description: ${deal.description || "No description provided"}
- Deal Terms: ${deal.deal_terms || "Not specified"}
- Next Steps: ${deal.hs_next_step || "Not specified"}

**Company Information (from application form):**
${
  company
    ? `
- Company Name: ${company.name || "N/A"}
- Industry: ${company.industry || "N/A"}
- Location: ${[company.city, company.state, company.country].filter(Boolean).join(", ") || "N/A"}
- Founded: ${company.founded_year || "N/A"}
- Employees: ${company.num_employees || company.numberofemployees || "N/A"}
- Website: ${company.website || company.domain || "N/A"}
- Description: ${company.description || "No description provided"}
- Annual Revenue: ${company.annualrevenue || "Not disclosed"}
`
    : "No company data available."
}

**Your task:**
Write a compelling, professional email section (2-3 short paragraphs) that includes:
1. **What they do** (1-2 sentences) - Clear explanation of the product/service and problem solved
2. **${isCompletedInvestment ? "Investment details" : "Deal details"}** (2-3 sentences) - ${isCompletedInvestment ? "When we invested, amount, what they've achieved since our investment" : "Key investment terms, amount, stage, and use of funds"}
3. **Why we ${isCompletedInvestment ? "invested" : "like it"}** (2-3 sentences) - Specific strengths like traction, team, market opportunity, or unique advantages

**FORMATTING REQUIREMENTS:**
- Link the company name ONLY on its FIRST mention using: <strong><a href="${company?.website || company?.domain || '#'}">${company?.name || deal.dealname}</a></strong>
- Use the company name "${company?.name || deal.dealname}" throughout (NOT the deal name "${deal.dealname}")
- After the first mention, use the company name as plain text (no link, no bold)
- Output as plain text with paragraphs separated by blank lines (NOT HTML)
- Each paragraph should be separated by ONE blank line
- DO NOT use Markdown links like [text](url) - use HTML <a> tags for the company name link
- DO NOT link the company name multiple times - only the first occurrence

**CRITICAL Guidelines:**
${isCompletedInvestment ? `
- ✅ DO use PAST TENSE: "We invested...", "We backed...", "We deployed...", "Since our investment..."
- ✅ DO make it clear this is ALREADY a portfolio company
- ❌ DO NOT use phrases like: "we're considering", "we're evaluating", "potential investment", "opportunity to invest"
- ✅ DO mention what they've achieved since the investment if relevant
` : `
- ✅ DO use PRESENT/FUTURE tense: "We're evaluating...", "We're excited about...", "This could be..."
- ✅ DO make it clear this is a potential opportunity being considered
- ❌ DO NOT use past tense like "we invested" or "we backed"
`}
- Be concise and scannable (max 150 words total)
- Use specific numbers and facts when available
- Write in first person plural ("we") as if from the fund
- Avoid generic platitudes - be specific to THIS deal
- Use professional but engaging tone

${customGuidance ? `\n**ADDITIONAL CUSTOM GUIDANCE:**\n${customGuidance}\n` : ''}

**OUTPUT FORMAT:**
Respond with plain text content formatted as follows:
- 3 paragraphs total
- Separate each paragraph with ONE blank line
- Link company name on first mention ONLY using HTML: <strong><a href="url">${deal.dealname}</a></strong>
- Do NOT use Markdown formatting
- Do NOT include subject line, greeting, or signature
- Do NOT add extra spacing between paragraphs`;

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 500,
        });

        let emailContent = completion.choices[0].message.content || "";
        
        // Post-process to format with double line breaks for rich text copy/paste:
        // 1. Clean up excessive line breaks
        emailContent = emailContent.trim().replace(/\n{3,}/g, '\n\n');
        
        // 2. Split into paragraphs and join with <br><br> for spacing
        const paragraphs = emailContent
          .split('\n\n')
          .filter(p => p.trim())
          .map(p => p.replace(/\n/g, ' ').trim()); // Join lines within paragraphs
        
        // Join paragraphs with double <br> for proper spacing when copying as rich text
        emailContent = paragraphs.join('<br><br>');

        return {
          dealId: deal.hs_object_id || dealIds[dealsWithCompanyData.indexOf({ deal, company })],
          dealName: company?.name || deal.dealname || "Untitled Deal",
          emailContent: emailContent.trim(),
        };
      } catch (aiError: any) {
        console.error(
          `Error generating email content for deal ${deal.dealname}:`,
          aiError
        );
        return {
          dealId: deal.hs_object_id || dealIds[dealsWithCompanyData.indexOf({ deal, company })],
          dealName: company?.name || deal.dealname || "Untitled Deal",
          emailContent: `Failed to generate content: ${aiError.message}`,
          error: true,
        };
      }
    });

    const emailContents = await Promise.all(emailContentPromises);

    console.log(`Successfully generated email content for ${emailContents.length} deals`);

    return NextResponse.json({
      success: true,
      emailContents,
    });
  } catch (error: any) {
    console.error("Error in generate-email API:", error);
    return NextResponse.json(
      {
        error: error.message || "An unknown error occurred.",
        details: error.stack,
      },
      { status: 500 }
    );
  }
}

