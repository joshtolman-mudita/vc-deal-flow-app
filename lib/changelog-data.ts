/**
 * Structured changelog data for in-app display
 * Source: CHANGELOG.md
 */

export interface ChangelogVersion {
  version: string;
  date: string;
  sections: {
    added?: string[];
    changed?: string[];
    fixed?: string[];
    removed?: string[];
  };
}

export const CHANGELOG: ChangelogVersion[] = [
  {
    version: "2.2.0",
    date: "2026-02-26",
    sections: {
      added: [
        "Deal Flow page: company search box in the filter toolbar (real-time, same design as diligence page).",
        "Deal Flow page: ARR column showing annual recurring revenue synced from the linked diligence record via HubSpot portco_arr deal property.",
        "Deal Flow page: ARR (Min $) filter in the toolbar — click-to-edit, accepts full dollar amounts, displays formatted ($160K, $1.2M).",
        "Deal Flow page: Post Money Valuation (Max $M) and Remaining Round (Min $M) filters are now click-to-edit fields — shows formatted value when set, 'Any' when unset.",
        "Deal Flow page: Deal Stage column now displays as a color-coded badge (Deal 0 = slate, Deal 1 = blue, … Deal 7/Closed = emerald/red) and is click-to-edit inline — selecting a new stage updates HubSpot immediately.",
        "Diligence page: company search box in the filter toolbar matching the Deal Flow page.",
        "ARR bidirectional sync: saving key metrics in a diligence record now writes ARR to the portco_arr HubSpot deal property as a plain dollar integer.",
        "ARR backfill script (scripts/backfill-arr.js) to populate portco_arr for existing diligence records.",
      ],
      changed: [
        "Navigation and page title renamed from 'Deals' to 'Deal Flow'.",
        "Round Status filter simplified to two independent toggles (Open / Closed) — both on or both off shows all; defaults to Open only.",
        "Description column is wider (w-72), truncates at 4 lines, and shows the full text on hover.",
        "Post Money Valuation filter label updated to 'Post Money Valuation (Max $M)'; Remaining Round label updated to 'Remaining Round (Min $M)'.",
        "Industry filter in the drawer is now fully faceted — options update in real time based on all other active filters (name search, round status, valuation, room left).",
        "Diligence page default sort changed to priority descending (High → Medium → Low → None) with score descending as tiebreaker.",
        "HubSpot sync badges removed from the key metrics grid on the diligence detail page.",
        "ARR data layer: portco_arr (number, plain dollars) is now fetched from HubSpot and formatted to $1.2M / $160K for display; diligence record ARR used as fallback when HubSpot value is not yet set.",
        "Removed subtitle 'Manage and filter deals from HubSpot' from the Deal Flow page header.",
      ],
      fixed: [
        "Duplicate deal rows caused by HubSpot API returning the same deal ID on multiple pages — deduplicated on both fresh fetch and cache load.",
        "roundStillOpenFilter reference error on the Deal Flow page after state was migrated to independent filterOpen/filterClosed booleans.",
      ],
    },
  },
  {
    version: "2.1.1",
    date: "2026-02-19",
    sections: {
      fixed: [
        "Delete/archive confirmation modal now always appears on top of other UI elements (z-index raised to z-100 on both list and detail pages).",
        "Delete and archive buttons now correctly typed as type=button to prevent accidental form submission.",
        "Scoring information (category scores, thesis summary, document list) no longer written into HubSpot Next Steps field during sync.",
        "When rejecting a deal from thesis check, required Closed Lost fields (reject reason, notes, round still open) now stay visible if the form submission fails — previously the fields were hidden after a failed attempt.",
        "Removed redundant Close button from top of HubSpot create modal — Cancel at the bottom is the only dismiss action.",
        "Reject flow now correctly sets stage to Deal 7: Deal Rejected instead of accidentally selecting Deal 7: Close Win / Deploy Funds.",
        "Industry values stored as HubSpot enum format (e.g. FINANCIAL_SERVICES) now display as human-readable labels (e.g. Financial Services) in scoring grid answers.",
      ],
    },
  },
  {
    version: "2.1.0",
    date: "2026-02-19",
    sections: {
      added: [
        "Thesis-first check pass on new diligence records: generates company description, problem, solution, why fits, why might not be a fit, evidence gaps, and crux question before full scoring.",
        "Why this fits injected into the investment thesis section on the detail page.",
        "Thesis check drives the primary concern question and crux question for founder follow-ups.",
        "DocSend link ingestion with session/cookie fallback and Jina AI mirror fallback.",
        "Document readability warning (amber banner) shown when uploaded files or links cannot be extracted for AI use.",
        "OCR fallback for image-based PDFs via temporary Google Drive Doc conversion.",
        "Structured facts extractor shared between full scoring and thesis-first pass for consistent context quality.",
      ],
      changed: [
        "Thesis-first snapshot (company description, problem, solution) now uses single-sentence, clean output sourced from structured fact extraction — same quality as full scoring.",
        "Why might not be a fit only surfaces genuine thesis conflicts; absence-of-dealbreaker noise (e.g., no hardware dependency, no blockchain component) is suppressed.",
        "HubSpot enrichment now only trusted when HubSpot domain matches the deal company URL — prevents wrong CRM records from injecting bad ARR or location data.",
        "Raise amount extraction uses scored pattern matching to prefer explicit raise slides over future-plan text.",
        "Synergy fallback summary is now context-aware when company information is available.",
      ],
      fixed: [
        "ARR metric no longer inherits annualRevenue from mismatched HubSpot company records.",
        "Location criterion no longer inherits country from mismatched HubSpot company records.",
        "Funding amount no longer picks up future-plan capital raises (e.g., raise $10M for carrier) over the current slide raise target.",
        "Thesis check snapshot no longer contains deck slide-outline fragments, bio text, web search error lines, or spaced-all-caps noise.",
        "WhyNotFit never outputs No indication of X absence statements.",
      ],
    },
  },
  {
    version: "2.0.1",
    date: "2026-02-16",
    sections: {
      fixed: [
        "Lead metric extraction: Tightened regex to only capture investor-specific fields (lead investor, lead vc, lead information) instead of generic lead patterns that could match narrative text.",
        "Runway field validation: Added server-side normalization to convert common runway input formats (e.g., 3-6 months) to HubSpot's exact required options (e.g., 3 - 6 months) before API submission.",
        "Score consistency across views: List page, detail page, and PDF exports now all use the same client-side score calculation logic that accounts for criterion-level and category-level manual overrides, ensuring displayed scores always match.",
        "Overall score persistence: Criterion-level manual overrides now properly recalculate and persist the overall score to storage when saved.",
        "Category score calculation: Category scores now strictly computed from criterion scores (including criterion-level manual overrides), ignoring legacy category-level override fields to ensure scoring grid math always adds up correctly.",
        "PDF answer composition: PDF exports now use the same dynamic answer templates as the detail page, ensuring answers like market growth and problem necessity display correctly instead of showing raw AI text.",
        "Deployment configuration: Added APP_PASSWORD to Cloud Run environment variables in build config to prevent authentication issues after deployments.",
      ],
    },
  },
  {
    version: "2.0.0",
    date: "2026-02-15",
    sections: {
      added: [
        "Scoring orchestration now runs Team, Portfolio Synergy, and Problem Necessity research before scoring and rescoring for stronger section quality.",
        "Live scoring progress updates on both new diligence and detail rescore flows.",
        "HubSpot stage selector added on diligence detail with write-through sync.",
        "Category-level re-score action added in scoring grid headers.",
        "TAM and Market Growth fallback estimation expanded with external evidence parsing and sector heuristics.",
        "New answer-builder tokens for concise answers: businessModelThesis, teamStrengthLabel, portfolioSynergyLevel, and improved TAM/market growth token support.",
        "Release checklist added in-repo at RELEASE_CHECKLIST.md.",
      ],
      changed: [
        "TAM and Market Growth AI details now use cleaner natural prose with concise method and assumption backup.",
        "Problem Necessity, Team, and Synergy AI details now read as specific sentence-based analysis instead of trace-style output.",
        "Key Metrics source metadata moved to hover text (no persistent source badges).",
        "Scoring grid controls simplified by removing manual TAM/Team/Synergy/Problem Necessity research buttons and inline research boxes.",
        "PDF export redesigned to mirror current scoring grid shape, include smarter details selection, better pagination, and clickable founder name links.",
      ],
      fixed: [
        "ARR parsing errors from growth multipliers (for example, 8x) and improved contracted ARR capture from notes.",
        "Funding amount misread from cash-on-hand language is now guarded in extraction, scoring prep, and reasoning output.",
        "Founder TAM attribution now avoids mislabeling AI-derived TAM as founder-claimed TAM.",
        "Business model answer-builder fallbacks no longer show not available when AI details exist.",
        "Release-note and footer version display now aligned with package version 2.0.0.",
      ],
      removed: [
        "Scoring-grid TAM calculation button and TAM analysis trace box.",
        "Scoring-grid Team research button/box and Synergy research button/box.",
        "Scoring-grid Problem Necessity manual research button/box.",
      ],
    },
  },
  {
    version: "1.2.0",
    date: "2026-01-26",
    sections: {
      added: [
        "Editable Metrics Block - New metrics section between Overall Score and Category Breakdown displaying ARR, TAM, ACV, and YoY Growth Rate",
        "Editable Metrics Block - Auto-populates from extracted facts and external intelligence",
        "Editable Metrics Block - Manual overrides persist and serve as source of truth for scoring",
        "Editable Metrics Block - Compact 2x2 grid layout for space efficiency",
        "Intelligent Metric Calculation - Conservative ARR extraction (excludes projected/forecasted values)",
        "Intelligent Metric Calculation - YoY Growth Rate computed from historical year-over-year ARR data",
        "Intelligent Metric Calculation - ACV extraction from explicit evidence only",
        "Intelligent Metric Calculation - Metrics included in scoring fingerprint for incremental rescore detection",
        "Status Management - Mark diligence records as 'In Progress' or 'Passed On'",
        "Status Management - Status dropdown on diligence detail page",
        "Status Management - Per-row status selector on main diligence list",
        "Status Management - Status filtering on main list page (defaults to 'In Progress' only)",
        "Status Management - Multi-select filter to show one or both statuses",
        "Incremental Re-scoring - Smart re-scoring that skips redundant work when no new information detected",
        "Incremental Re-scoring - Default 'Re-score' button performs incremental analysis",
        "Incremental Re-scoring - 'Full re-score' option via dropdown menu for forced refresh",
        "Incremental Re-scoring - Fingerprint-based change detection for documents, notes, and metrics",
        "Enhanced Scoring Quality - Natural prose reasoning (removed explicit 'Claim/Evidence/Implication' labels)",
        "Enhanced Scoring Quality - Semantic deduplication for concerns and follow-up questions",
        "Enhanced Scoring Quality - Override-aware suppression of previously addressed risks",
        "Enhanced Scoring Quality - Materiality-ranked concerns based on score, confidence, and evidence status",
        "Enhanced Scoring Quality - Improved concern/question substantiation with evidence linking",
      ],
      changed: [
        "Metrics now ground AI scoring as authoritative source of truth",
        "Re-score explanations include structured narrative with score snapshots, category changes, and material risks",
        "Scoring version bumped to enforce conservative metric inference",
        "Status badges now read 'Passed On' instead of 'Passed'",
        "Diligence list stats updated to reflect visible (filtered) records",
      ],
      fixed: [
        "Over-inference in ACV calculation (removed ARR/customer fallback)",
        "Projected/forecasted values incorrectly used for ARR and YoY Growth",
        "Duplicate status labels on detail page",
        "Reasoning output still using technical template format in some cases",
      ],
    },
  },
  {
    version: "1.1.0",
    date: "2026-02-08",
    sections: {
      added: [
        "Code Refactoring & Architecture - Created custom hooks for diligence record management (useDiligenceRecord, useDiligenceActions)",
        "Code Refactoring & Architecture - Added centralized API utility functions (diligence-api.ts)",
        "Code Refactoring & Architecture - Created formatting utilities for common display operations",
        "Code Refactoring & Architecture - Added common TypeScript types for better type safety",
        "Code Refactoring & Architecture - New reusable components: ThesisSection, ScoreDisplayCard",
        "Code Refactoring & Architecture - Comprehensive refactoring documentation (REFACTORING.md)",
        "Document link enhancements - Access email field for authentication-required links",
        "Document link enhancements - Copy email to clipboard functionality",
        "Document link enhancements - Visual indicators for links requiring email access",
        "Document link enhancements - Support in both new diligence and detail pages",
        "Note improvements - Added title field for individual notes",
        "Note improvements - Collapsible/expandable note display",
        "Note improvements - Show note title with click-to-expand functionality",
        "Note improvements - Simplified notes section header to 'Notes'",
        "Note improvements - Add Note button always visible in header",
        "Note improvements - Backward compatibility for notes without titles",
        "Thesis editing capabilities - Edit button for investment thesis fields",
        "Thesis editing capabilities - Manual score override persistence on re-score",
        "Thesis editing capabilities - Visual indicators for edited fields (italic text and colored pen icon)",
        "Thesis editing capabilities - Re-scoring uses edited thesis for context",
        "Release Notes Access - Added version number in app footer",
        "Release Notes Access - Clickable version opens release notes modal",
        "Release Notes Access - Full changelog history accessible in-app",
      ],
      changed: [
        "Improved code organization and maintainability",
        "Reduced code duplication through centralized utilities",
        "Enhanced type safety across the application",
        "Better separation of concerns in components",
        "Improved notes UX with collapsible interface",
        "Enhanced document link workflow with email support",
        "Better visual feedback for edited content",
      ],
      fixed: [
        "Notes section layout and button hierarchy",
        "Hydration errors with nested buttons",
        "Note title backward compatibility",
      ],
      removed: [
        "Fathom integration (temporarily removed for future implementation - will be revisited with improved API integration)",
        "Debug/instrumentation logs from production code",
      ],
    },
  },
  {
    version: "1.0.0",
    date: "2026-02-04",
    sections: {
      added: [
        "Diligence Module - Complete investment diligence workflow",
        "Diligence Module - Upload documents (PDF, DOCX, PPTX, XLSX) or provide company URLs",
        "Diligence Module - AI-powered scoring against custom criteria from Google Sheets",
        "Diligence Module - Web research integration via Serper API for external data",
        "Diligence Module - Investment thesis generation with problem/solution/ICP analysis",
        "Diligence Module - Categorized notes system aligned with diligence criteria",
        "Diligence Module - AI chat interface for discussing companies",
        "Diligence Module - Document management with Google Drive integration",
        "Diligence Module - HubSpot deal sync capability",
        "Deal Management - HubSpot integration for deal and partner tracking",
        "Deal Management - Sync deals and partners from HubSpot",
        "Deal Management - AI-powered VC matching based on investment criteria",
        "Deal Management - Deal stage tracking and filtering",
        "Deal Management - Company profile views with HubSpot links",
        "Email Generation - AI-powered email composition for deal outreach",
        "Email Generation - Select multiple deals to feature",
        "Email Generation - Customizable header, footer, and content prompts",
        "Email Generation - Rich text editor with formatting support",
        "Email Generation - Copy to clipboard functionality",
        "Dashboard - Overview of recent active deals and top diligence scores",
        "Authentication - Password-protected access for team members",
        "Authentication - Simple password authentication (APP_PASSWORD)",
        "Authentication - 30-day session cookies",
        "Authentication - Login page with Mudita branding",
        "Google Cloud Deployment - Production-ready deployment on Cloud Run",
        "Google Cloud Deployment - Automated CI/CD with Cloud Build",
        "Google Cloud Deployment - Google Cloud Storage for persistent data",
        "Google Cloud Deployment - Environment-based configuration (local/production)",
        "Google Cloud Deployment - Auto-scaling from 0 to 3 instances",
      ],
    },
  },
];

export const CURRENT_VERSION = "2.2.0";

export function getLatestVersion(): ChangelogVersion {
  return CHANGELOG[0];
}

export function getVersionByNumber(version: string): ChangelogVersion | undefined {
  return CHANGELOG.find(v => v.version === version);
}
