// Type definitions for the Diligence Module

export interface DiligenceNote {
  id: string;
  category: string; // Category name from criteria, or "Overall"
  title: string; // Note title
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiligenceQuestion {
  id: string;
  question: string;
  answer?: string;
  status: 'open' | 'answered';
  category?: string; // optional link to a scoring category
  createdAt: string;
  answeredAt?: string;
}

export interface Founder {
  name: string;
  linkedinUrl?: string;
  title?: string;
  hasPriorExit?: boolean;
  priorExits?: string[];
  hasBeenCEO?: boolean;
  hasBeenCTO?: boolean;
  experienceSummary?: string;
  confidence?: number;
}

export interface TeamResearch {
  summary: string;
  teamScore?: number;
  founders: Founder[];
  analyzedAt: string;
}

export interface PortfolioSynergyMatch {
  companyName: string;
  rationale: string;
  synergyType: 'similar_space' | 'similar_customer' | 'complementary_offering';
}

export interface PortfolioSynergyResearch {
  summary: string;
  synergyScore?: number;
  matches: PortfolioSynergyMatch[];
  analyzedAt: string;
  sourceUrl?: string;
}

export interface ProblemNecessitySignal {
  label: string;
  evidence: string;
  strength?: 'low' | 'medium' | 'high';
}

export interface ProblemNecessityResearch {
  summary: string;
  necessityScore?: number;
  classification?: 'vitamin' | 'advil' | 'vaccine';
  topSignals: ProblemNecessitySignal[];
  counterSignals: ProblemNecessitySignal[];
  analyzedAt: string;
}

export interface HubSpotCompanyData {
  companyId: string;
  name?: string;
  domain?: string;
  description?: string;
  website?: string;
  annualRevenue?: string;
  numberOfEmployees?: string;
  foundedYear?: string;
  city?: string;
  state?: string;
  country?: string;
  linkedinUrl?: string;
  industrySector?: string;
  investmentSector?: string;
  industry?: string;
  productCategorization?: string;
  fundingStage?: string;
  fundingAmount?: string;
  fundingValuation?: string;
  currentCommitments?: string;
  tamRange?: string;
  currentRunway?: string;
  postFundingRunway?: string;
  leadInformation?: string;
  pitchDeckUrl?: string;
  anythingElse?: string;
  fetchedAt?: string;
}

export interface HubSpotContactData {
  contactId: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  title?: string;
  linkedinUrl?: string;
  background?: string;
}

export interface DiligenceRecord {
  id: string;
  companyName: string;
  companyUrl?: string; // Company website URL
  companyDescription?: string; // Brief description or notes about the company
  companyOneLiner?: string; // 1-2 sentence description of what the company does
  industry?: string; // Company industry/sector
  priority?: string; // Deal priority synced with HubSpot hs_priority
  founders?: Founder[]; // Company founders with LinkedIn profiles
  teamResearch?: TeamResearch;
  portfolioSynergyResearch?: PortfolioSynergyResearch;
  problemNecessityResearch?: ProblemNecessityResearch;
  metrics?: DiligenceMetrics; // Source-of-truth deal metrics for scoring and display
  notes?: string; // Deprecated: legacy single note field
  categorizedNotes: DiligenceNote[]; // New: multiple categorized notes
  questions?: DiligenceQuestion[]; // Open questions and answers for tracking and scoring
  googleDriveFolderId?: string; // Google Drive folder for this diligence
  documents: DiligenceDocument[];
  score: DiligenceScore | null;
  chatHistory: ChatMessage[];
  recommendation: string | null;
  status: 'in_progress' | 'completed' | 'passed' | 'declined';
  hubspotDealId?: string;
  hubspotSyncedAt?: string; // When last synced to HubSpot
  hubspotDealStageId?: string;
  hubspotDealStageLabel?: string;
  hubspotPipelineId?: string;
  hubspotPipelineLabel?: string;
  hubspotAmount?: string;
  hubspotCompanyId?: string;
  hubspotCompanyName?: string;
  hubspotCompanyData?: HubSpotCompanyData;
  thesisFit?: ThesisFitResult;
  decisionOutcome?: {
    decision: 'invested' | 'passed' | 'pending';
    decisionDate?: string;
    decisionReason?: string;
    actualPerformance?: string; // Post-investment notes
  };
  createdAt: string;
  updatedAt: string;
}

export interface ThesisFitResult {
  fit: 'on_thesis' | 'mixed' | 'off_thesis';
  confidence: number; // 0-100
  companyDescription?: string; // concise first-pass description of company
  problemSolving?: string; // concise first-pass summary of problem they solve
  solutionApproach?: string; // concise first-pass summary of how they solve it
  whyFits: string[]; // short evidence-based bullets for why it fits
  whyNotFit: string[]; // short evidence-based bullets for why it may not fit
  evidenceGaps?: string[]; // missing information that lowers confidence but is not thesis conflict
  cruxQuestion?: string; // single decision-driving question to resolve key uncertainty
  // Legacy fields retained for backward compatibility with older records.
  rationale?: string[];
  topRisks?: string[];
  evidenceAnchors: string[]; // concrete evidence lines used for judgment
  computedAt: string;
  modelVersion: string;
}

export interface ThesisFitFeedbackEntry {
  id: string;
  diligenceId: string;
  companyName: string;
  createdAt: string;
  sourceEntryId?: string;
  sourceCreatedAt?: string;
  sourceEnvironment?: string;
  reviewerFit: 'on_thesis' | 'mixed' | 'off_thesis';
  reviewerConfidence?: number;
  reviewerWhyFits: string[];
  reviewerWhyNotFit: string[];
  reviewerEvidenceGaps?: string[];
  reviewerCruxQuestion?: string;
  reviewerNotes?: string;
  chatgptAssessment?: string;
  appAssessmentNotes?: string;
  appThesisFitSnapshot?: ThesisFitResult;
}

export interface DiligenceDocument {
  id: string;
  name: string;
  type: 'deck' | 'financial' | 'legal' | 'other';
  fileType: string; // pdf, pptx, docx, etc.
  googleDriveId?: string; // Optional for external links
  googleDriveUrl?: string; // Optional for external links
  externalUrl?: string; // External document URL (instead of upload)
  accessEmail?: string; // Email required to access the external link
  linkIngestStatus?: 'ingested' | 'email_required' | 'failed';
  linkIngestMessage?: string;
  linkIngestedAt?: string;
  uploadedAt: string;
  extractedText?: string;
  size?: number; // file size in bytes (optional for external links)
}

export interface DiligenceMetricValue {
  value?: string;
  source?: 'auto' | 'manual';
  sourceDetail?: 'notes' | 'facts' | 'hubspot' | 'manual' | 'market_research';
  updatedAt?: string;
}

export interface DiligenceMetrics {
  arr?: DiligenceMetricValue;
  tam?: DiligenceMetricValue;
  marketGrowthRate?: DiligenceMetricValue;
  acv?: DiligenceMetricValue;
  yoyGrowthRate?: DiligenceMetricValue;
  fundingAmount?: DiligenceMetricValue;
  committed?: DiligenceMetricValue;
  valuation?: DiligenceMetricValue;
  dealTerms?: DiligenceMetricValue;
  lead?: DiligenceMetricValue;
  currentRunway?: DiligenceMetricValue;
  postFundingRunway?: DiligenceMetricValue;
  location?: DiligenceMetricValue;
}

export interface DiligenceScore {
  overall: number; // 0-100
  categories: CategoryScore[];
  strengths?: string[]; // Deprecated: now covered in thesisAnswers
  concerns?: string[]; // Deprecated: now covered in thesisAnswers
  dataQuality: number; // 0-100
  scoredAt: string;
  thesisAnswers?: ThesisAnswers; // answers to key investment questions
  rescoreExplanation?: string; // Explanation of why scores changed after re-scoring
  followUpQuestions?: string[]; // Additional diligence questions generated from missing evidence
  externalMarketIntelligence?: ExternalMarketIntelligence; // Structured external TAM/competition research
  scoringInputFingerprint?: string; // Fingerprint of core scoring inputs for incremental rescore checks
  scoringMode?: 'incremental' | 'full';
}

export interface ExternalMarketIntelligence {
  tamSamSom?: {
    companyClaim?: {
      tam?: string;
      sam?: string;
      som?: string;
      source?: string;
    };
    independentEstimate?: {
      tam?: string;
      sam?: string;
      som?: string;
      method?: string;
      assumptions?: string[];
    };
    comparison?: {
      alignment: 'aligned' | 'somewhat_aligned' | 'overstated' | 'understated' | 'unknown';
      deltaSummary?: string;
      confidence?: number; // 0-100
    };
  };
  competitors?: {
    name: string;
    overlap?: 'low' | 'medium' | 'high';
    fundingRaised?: string;
    concernLevel?: 'low' | 'medium' | 'high';
    rationale?: string;
  }[];
  competitiveThreatScore?: number; // 0-100, higher = more concern
  marketGrowth?: {
    estimatedCagr?: string;
    growthBand?: 'high' | 'moderate' | 'low' | 'unknown';
    confidence?: number; // 0-100
    evidence?: string[];
    summary?: string;
  };
  externalSummary?: string;
}

export interface ThesisAnswers {
  problemSolving: string; // What problem are they solving?
  solution: string; // How are they solving this problem?
  whyMightFit?: string[]; // Why this may fit the thesis (bullet points)
  exciting: string[]; // What is exciting about this deal? (bullet points)
  concerning: string[]; // What is concerning about this deal? (bullet points)
  idealCustomer: string; // What is their ideal customer profile?
  founderQuestions?: {
    questions: string[]; // Top 3 questions to ask the founder
    keyGaps: string; // What critical information is missing
    primaryConcern: string; // The most concerning aspect requiring clarification
  };
  manuallyEdited?: boolean; // True if user has manually edited any thesis answers
}

export interface CategoryScore {
  category: string;
  score: number; // AI-generated score (0-100)
  manualOverride?: number; // User can override AI score (0-100)
  weight: number; // from criteria sheet
  weightedScore: number; // calculated from effective score (override || score)
  criteria: CriterionScore[];
  overrideReason?: string; // Why the user adjusted the score
  overrideSuppressTopics?: string[]; // Optional risk topics to suppress from auto-generated concerns
  overridedAt?: string; // When it was overridden
}

export interface CriterionScore {
  name: string;
  score: number; // AI-generated score (0-100)
  manualOverride?: number; // User can also override individual criteria (0-100)
  answer?: string; // composed answer in scoring grid
  userPerspective?: string; // user-entered perspective/rationale in scoring grid
  reasoning: string;
  evidence: string[]; // quotes from documents
  confidence?: number; // confidence in score (0-100)
  evidenceStatus?: 'supported' | 'weakly_supported' | 'unknown' | 'contradicted';
  missingData?: string[]; // missing data that limits scoring confidence
  followUpQuestions?: string[]; // tactical questions for this criterion
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface DiligenceCriteria {
  categories: CriteriaCategory[];
  lastUpdated: string;
}

export interface CriteriaCategory {
  name: string;
  weight: number; // percentage
  criteria: Criterion[];
}

export interface Criterion {
  name: string;
  description: string;
  scoringGuidance: string;
  insufficientEvidenceCap?: number; // optional per-criterion score cap when evidence is weak/unknown
  fieldRegistryKey?: string; // optional link to a field_name in config/field-registry.csv
  answerBuilder?: string; // optional template for auto-composing criterion answer from metrics
}

// API Request/Response types
export interface UploadDocumentsRequest {
  companyName: string;
  diligenceId?: string; // for adding to existing diligence
}

export interface UploadDocumentsResponse {
  diligenceId: string;
  documents: DiligenceDocument[];
  success: boolean;
  error?: string;
}

export interface ScoreDiligenceRequest {
  diligenceId: string;
}

export interface ScoreDiligenceResponse {
  score: DiligenceScore;
  success: boolean;
  error?: string;
}

export interface ChatRequest {
  diligenceId: string;
  message: string;
}

export interface HubSpotSyncRequest {
  diligenceId: string;
}

export interface HubSpotSyncResponse {
  dealId: string;
  dealUrl: string;
  success: boolean;
  error?: string;
}

export interface CreateDiligenceRequest {
  companyName: string;
}

export interface UpdateDiligenceRequest {
  recommendation?: string;
  status?: DiligenceRecord['status'];
}

export interface HubSpotDealLookup {
  id: string;
  name: string;
  stageId?: string;
  stageLabel?: string;
  pipelineId?: string;
  pipelineLabel?: string;
  amount?: string;
  priority?: string;
  raiseAmount?: string;
  committedFunding?: string;
  dealValuation?: string;
  dealTerms?: string;
  description?: string;
  currentRunway?: string;
  postFundingRunway?: string;
  url?: string;
}

export interface DiligenceHubSpotData {
  dealId: string;
  dealName: string;
  stageId?: string;
  stageLabel?: string;
  pipelineId?: string;
  pipelineLabel?: string;
  amount?: string;
  priority?: string;
  raiseAmount?: string;
  committedFunding?: string;
  dealValuation?: string;
  dealTerms?: string;
  currentRunway?: string;
  postFundingRunway?: string;
  url?: string;
  syncedAt?: string;
}
