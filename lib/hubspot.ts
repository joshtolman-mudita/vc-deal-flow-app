import { Client } from "@hubspot/api-client";

if (!process.env.HUBSPOT_ACCESS_TOKEN) {
  console.warn("Warning: HUBSPOT_ACCESS_TOKEN is not set in environment variables");
}

const hubspotClient = new Client({
  accessToken: process.env.HUBSPOT_ACCESS_TOKEN,
});

export default hubspotClient;

// Helper function to check if HubSpot is configured
export function isHubSpotConfigured(): boolean {
  return !!process.env.HUBSPOT_ACCESS_TOKEN && process.env.HUBSPOT_ACCESS_TOKEN !== 'your_hubspot_access_token_here';
}

