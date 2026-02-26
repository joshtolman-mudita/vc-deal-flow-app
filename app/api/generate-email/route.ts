import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import hubspotClient, { isHubSpotConfigured } from "@/lib/hubspot";
import { buildDiligenceLookupMaps, resolveDiligenceContextForDeal } from "@/lib/matching-diligence";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper to fetch contact form submission data from HubSpot
async function fetchContactFormData(dealId: string) {
  try {
    if (!isHubSpotConfigured()) {
      return null;
    }

    // Get associated contacts for the deal
    const associations = await (hubspotClient.crm.deals as any).associationsApi.getAll(
      dealId,
      "contacts"
    );

    if (!associations.results || associations.results.length === 0) {
      return null;
    }

    // Get the primary contact (first one)
    const contactId = associations.results[0].id;

    // Fetch contact with all properties
    const contact = await hubspotClient.crm.contacts.basicApi.getById(contactId, undefined, undefined, undefined, undefined);

    // Extract relevant form submission data
    const formData: any = {};
    const props = contact.properties;

    // Common form fields - map to readable names
    if (props) {
      // Basic info
      if (props.firstname || props.lastname) formData.founder_name = `${props.firstname || ""} ${props.lastname || ""}`.trim();
      if (props.email) formData.email = props.email;
      if (props.phone) formData.phone = props.phone;
      if (props.jobtitle) formData.role = props.jobtitle;
      
      // Company info
      if (props.company) formData.company_name = props.company;
      if (props.website) formData.website = props.website;
      
      // Deal-specific fields (these vary by form but common ones)
      if (props.hs_persona) formData.persona = props.hs_persona;
      if (props.industry) formData.industry = props.industry;
      if (props.numemployees) formData.company_size = props.numemployees;
      if (props.annualrevenue) formData.revenue = props.annualrevenue;
      
      // Custom form fields - capture any that look like form submissions
      Object.keys(props).forEach(key => {
        // Look for custom properties that might contain useful info
        if (key.startsWith('your_') || key.startsWith('what_') || key.startsWith('how_') || 
            key.startsWith('why_') || key.startsWith('describe_') || key.includes('_pitch_') ||
            key.includes('traction') || key.includes('funding') || key.includes('raise') ||
            key.includes('customer') || key.includes('market') || key.includes('problem') ||
            key.includes('solution') || key.includes('team')) {
          const value = props[key];
          if (value && typeof value === 'string' && value.length > 0) {
            // Convert property name to readable format
            const readableKey = key.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
            formData[readableKey] = value;
          }
        }
      });
    }

    return Object.keys(formData).length > 0 ? formData : null;
  } catch (error) {
    console.error(`Error fetching contact form data for deal ${dealId}:`, error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const { deals, customInstructions, emailHeading, emailFooter, emailPrompt } = await request.json();

    if (!deals || deals.length === 0) {
      return NextResponse.json(
        { error: "No deals provided" },
        { status: 400 }
      );
    }

    // Load diligence records once for all deals
    const diligenceLookup = await buildDiligenceLookupMaps();

    // Build the prompt for email generation - provide ALL available data
    const dealsContext = await Promise.all(deals.map(async (deal: any, idx: number) => {
      const dealInfo: string[] = [`Deal ${idx + 1}: ${deal.name}`];

      if (deal.website || deal.companyUrl) {
        dealInfo.push(`   Website: ${deal.website || deal.companyUrl}`);
      }

      // Use company industry if available, fall back to deal industry
      const industry = deal.companyIndustry || deal.industry;
      if (industry) {
        dealInfo.push(`   Industry: ${industry}`);
      }

      // Use company description if available, fall back to deal description
      const description = deal.companyDescription || deal.description;
      if (description) {
        dealInfo.push(`   Description: ${description}`);
      }

      if (deal.dealTerms) {
        dealInfo.push(`   Deal Terms: ${deal.dealTerms}`);
      }
      if (deal.nextSteps) {
        dealInfo.push(`   Next Steps: ${deal.nextSteps}`);
      }
      if (deal.stageName || deal.stage) {
        dealInfo.push(`   Stage: ${deal.stageName || deal.stage}`);
      }
      
      // Fetch contact form data from HubSpot
      const formData = await fetchContactFormData(deal.id || deal.hubspotId);
      if (formData) {
        dealInfo.push(`   === FOUNDER/FORM SUBMISSION DATA ===`);
        Object.entries(formData).forEach(([key, value]) => {
          dealInfo.push(`   ${key}: ${value}`);
        });
      }

      // Resolve diligence context from GCS-backed storage
      const diligenceContext = resolveDiligenceContextForDeal(deal, diligenceLookup);
      if (diligenceContext) {
        dealInfo.push(`   === DILIGENCE INSIGHTS ===`);
        if (diligenceContext.companyDescription && !description) {
          dealInfo.push(`   Company Description: ${diligenceContext.companyDescription}`);
        }
        if (diligenceContext.thesis?.problemSolving) {
          dealInfo.push(`   Problem: ${diligenceContext.thesis.problemSolving}`);
        }
        if (diligenceContext.thesis?.solution) {
          dealInfo.push(`   Solution: ${diligenceContext.thesis.solution}`);
        }
        if (diligenceContext.whyFits?.length) {
          dealInfo.push(`   Why We Like It:`);
          diligenceContext.whyFits.forEach(item => dealInfo.push(`     - ${item}`));
        }
        if (diligenceContext.thesis?.exciting?.length) {
          dealInfo.push(`   What's Exciting:`);
          diligenceContext.thesis.exciting.forEach(item => dealInfo.push(`     - ${item}`));
        }
        if (diligenceContext.thesis?.idealCustomer) {
          dealInfo.push(`   Ideal Customer: ${diligenceContext.thesis.idealCustomer}`);
        }
        if (diligenceContext.score !== undefined) {
          dealInfo.push(`   Diligence Score: ${diligenceContext.score}/100`);
        }
      }
      
      return dealInfo.join("\n");
    }));
    
    const dealsContextStr = dealsContext.join("\n\n");

    // Use custom prompt from settings or default guidance
    const contentGuidance = emailPrompt || `For each deal, include:
• Company name with embedded website URL link (format: Company Name <URL>)
• What they do in one sentence
• Key traction metrics if available
• Why this is an exciting opportunity
• Keep it concise and compelling`;

    const systemPrompt = `You are an expert VC associate drafting email content about specific deals.

CRITICAL FORMATTING RULES:
• Write as HTML formatted text (use <p>, <strong>, <em>, <a> tags)
• For company names, create clickable links using: <a href="FULL_URL">Company Name</a>
• Make sure URLs include http:// or https:// prefix
• Use <strong> for emphasis where appropriate
• Use <p> tags for paragraphs with style="margin-bottom: 1em;"
• Add TWO line breaks (<br><br>) between each company to ensure clear visual separation
• Keep HTML structure simple and clean

CRITICAL CONTENT RULES:
• Do NOT write any introductory paragraph or greeting
• Do NOT write any closing paragraph or call-to-action  
• ONLY write about the specific deals provided
• Start immediately with the first deal
• End immediately after the last deal
• The user will add their own intro and outro separately
• You MUST follow the user's content guidelines exactly - do not add fields they didn't ask for
• Only include information that the user's prompt specifically requests
• Ensure each company section is clearly separated with double line breaks

${customInstructions ? `\nAdditional instructions for this specific email:\n${customInstructions}\n` : ""}

User's Content Guidelines (FOLLOW THESE EXACTLY):
${contentGuidance}`;

    const userPrompt = `Here is the data available for ${deals.length} deal${deals.length > 1 ? 's' : ''}:

${dealsContextStr}

CRITICAL INSTRUCTIONS:
• Follow the user's content guidelines EXACTLY - only include the fields they specified
• Do NOT include fields like "Stage" or "Next Steps" unless the user's guidelines specifically ask for them
• Do NOT write an introduction or closing
• Start with the first deal immediately
• For company names, use this format: <a href="FULL_URL">Company Name</a>
• Make sure all URLs have http:// or https:// prefix
• Only use the data fields that match what the user asked for in their content guidelines
• IMPORTANT: Add <br><br> (two line breaks) between each company to ensure clear spacing when pasted into email clients`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 2000,
    });

    let emailContent = completion.choices[0].message.content || "";

    // Convert heading and footer to HTML paragraphs with proper spacing
    const parts = [];
    if (emailHeading) {
      // Convert plain text heading to HTML, preserving line breaks
      const headingHtml = emailHeading
        .trim()
        .split("\n")
        .map((line: string) => `<p style="margin-bottom: 1em;">${line}</p>`)
        .join("");
      parts.push(headingHtml);
    }
    
    // Ensure email content has proper paragraph spacing and add margin-bottom to all <p> tags
    let contentWithSpacing = emailContent.trim();
    
    // Add margin-bottom style to all <p> tags that don't have it
    contentWithSpacing = contentWithSpacing.replace(/<p>/g, '<p style="margin-bottom: 1em;">');
    contentWithSpacing = contentWithSpacing.replace(/<p style="margin-bottom: 1em;" style="margin-bottom: 1em;">/g, '<p style="margin-bottom: 1em;">');
    
    parts.push(contentWithSpacing);
    
    if (emailFooter) {
      // Convert plain text footer to HTML, preserving line breaks
      const footerHtml = emailFooter
        .trim()
        .split("\n")
        .map((line: string) => `<p style="margin-bottom: 1em;">${line}</p>`)
        .join("");
      parts.push(footerHtml);
    }

    const finalEmail = parts.join('<br><br>');

    return NextResponse.json({
      success: true,
      email: finalEmail,
    });
  } catch (error: any) {
    console.error("Error generating email:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate email" },
      { status: 500 }
    );
  }
}
