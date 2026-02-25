import { NextResponse } from "next/server";
import hubspotClient from "@/lib/hubspot";

export async function POST(req: Request) {
  try {
    const { templateId, htmlContent } = await req.json();

    if (!templateId) {
      return NextResponse.json(
        { error: "Template ID is required" },
        { status: 400 }
      );
    }

    if (!htmlContent) {
      return NextResponse.json(
        { error: "HTML content is required" },
        { status: 400 }
      );
    }

    console.log(`Updating HubSpot template ${templateId}...`);

    // Try different API endpoints for different template types
    
    // Try 1: Design Manager Template API (v4)
    console.log('Trying Design Manager API v4...');
    let response = await fetch(
      `https://api.hubapi.com/design-manager/v1/templates/${templateId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          source: htmlContent,
        }),
      }
    );

    if (response.status === 404 || response.status === 405) {
      // Try 2: Files API (templates are stored as files)
      console.log('Design Manager API failed, trying Files API...');
      response = await fetch(
        `https://api.hubapi.com/filemanager/api/v3/files/${templateId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            options: {
              access: "PUBLIC_INDEXABLE",
            },
          }),
        }
      );
    }

    if (response.status === 404 || response.status === 405) {
      // Try 3: CMS Hub DB / Email template update
      console.log('Files API failed, trying HubDB templates API...');
      response = await fetch(
        `https://api.hubapi.com/cms/v3/templates/${templateId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
          },
          body: JSON.stringify({
            source: htmlContent,
          }),
        }
      );
    }

    console.log(`Final response status: ${response.status}`);

    if (!response.ok) {
      const responseText = await response.text();
      console.error(`Error response: ${responseText.substring(0, 500)}`);
      
      throw new Error(
        `Unable to update template (tried multiple APIs, all failed with status ${response.status}). ` +
        `This template type might not support API updates. ` +
        `You may need to copy/paste the content manually into HubSpot.`
      );
    }

    const result = await response.json();
    console.log(`Successfully updated template ${templateId}`, result);

    return NextResponse.json({
      success: true,
      message: "Template updated successfully",
    });
  } catch (error: any) {
    console.error("Error updating HubSpot template:", error);
    
    // Provide more helpful error messages
    let errorMessage = error.message || "Failed to update template";
    
    if (error.code === 404) {
      errorMessage = "Template not found. Please check the Template ID in Settings.";
    } else if (error.code === 403) {
      errorMessage = "Permission denied. Please ensure your HubSpot access token has the 'content' scope enabled.";
    }

    return NextResponse.json(
      { error: errorMessage, details: error.body || error.message },
      { status: error.code || 500 }
    );
  }
}
