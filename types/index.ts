// Type definitions for the VC Deal Flow App

export interface Deal {
  id: string;
  name: string;
  industry: string;
  stage: string;
  stageName?: string; // Human-readable stage name
  amount: string;
  date: string;
  status: "Active" | "Shared" | "Archived";
  description?: string;
  hubspotId?: string;
  pipeline?: string;
  nextSteps?: string;
  dealTerms?: string;
  companyId?: string; // Associated HubSpot company ID
  createdate?: string; // HubSpot creation date
  url?: string; // HubSpot record URL
  diligenceId?: string;
  diligenceScore?: number;
  diligenceStatus?: "in_progress" | "completed" | "passed" | "declined";
}

export interface CompanyData {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  city?: string;
  state?: string;
  country?: string;
  founded_year?: string;
  num_employees?: string;
  linkedin_company_page?: string;
  description?: string;
  website?: string;
  annualrevenue?: string;
  [key: string]: any; // Allow additional custom properties
}

export interface Partner {
  id: string;
  name: string;
  type: string; // VC/PE/Debt or Family Office
  thesis: string; // VC: Thesis
  checkSize: string; // VC: Check Size
  investmentStage: string; // VC: Investment Stage
  investmentSpace: string; // VC: Investment Space (industries)
  regions: string; // VC: Regions of Investment
  domain?: string;
  city?: string;
  state?: string;
  country?: string;
  hubspotId?: string;
  createdDate?: string;
  lastModified?: string;
}

export interface InvestmentPreferences {
  industries: string[];
  stages: string[];
  minAmount?: number;
  maxAmount?: number;
  geographies?: string[];
}

export interface Campaign {
  id: string;
  name: string;
  status: "Draft" | "Scheduled" | "Sent" | "Active";
  recipients: string[];
  deals: string[];
  scheduledDate?: string;
  sentDate?: string;
  openRate?: number;
  clickRate?: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: "Admin" | "User";
}

// Export diligence types
export * from './diligence';
