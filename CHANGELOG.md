# Changelog

All notable changes to the VC Deal Flow App will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [2.1.1] - 2026-02-19

### Fixed
- Delete/archive confirmation modal now always renders on top of other UI elements (z-index raised on both list and detail pages).
- Delete and archive buttons explicitly typed as `type="button"` to prevent accidental form submission.
- Scoring summaries (scores, thesis notes, document list) are no longer written into the HubSpot **Next Steps** field during deal sync.
- Required Closed Lost fields (reject reason, notes, round still open) now stay visible if a reject-deal form submission fails — they were incorrectly hidden after a failed attempt.
- Removed the redundant **Close** button from the top of the HubSpot create modal.
- Reject flow correctly sets deal stage to **Deal 7: Deal Rejected** instead of accidentally selecting **Deal 7: Close Win / Deploy Funds**.
- Industry enum values stored in HubSpot format (e.g. `FINANCIAL_SERVICES`) now display as human-readable labels (e.g. `Financial Services`) in scoring grid answers.

## [2.1.0] - 2026-02-19

### Added
- **Thesis-first check pass**: On new diligence records, a thesis check now runs before full scoring and generates company description, problem, solution, why fits, why might not be a fit, evidence gaps, and crux question.
- **Why this fits on detail page**: Thesis check output is injected into the investment thesis section so relevant thesis fits appear alongside excitement signals.
- **Thesis check drives follow-ups**: Primary concern question and crux question are now seeded from the thesis check, surfacing the right founder questions earlier.
- **DocSend ingestion**: DocSend links now attempt content ingestion via session/cookie fallback and Jina AI mirror fallback before marking as failed.
- **Document readability warning**: An amber banner appears when any uploaded file or link cannot be extracted for AI use, preventing silent failures.
- **OCR fallback for image-based PDFs**: Unreadable PDFs now fall back to Google Drive Doc conversion for text extraction.
- **Shared structured facts extractor**: Full scoring and thesis-first pass now use the same structured facts extraction pipeline for consistent context quality.

### Changed
- **Cleaner thesis snapshot**: Company description, problem, and solution in thesis check now output a single clean sentence sourced from structured facts — matching full scoring quality.
- **Substantive why-not-fit only**: "Why might not be a fit" only surfaces genuine thesis conflicts. Absence-of-dealbreaker noise (e.g., "no hardware dependency", "no blockchain component") is suppressed entirely.
- **HubSpot domain trust guard**: HubSpot enrichment (ARR, location, etc.) is now only applied when the HubSpot company domain matches the deal company URL, preventing mismatched CRM records from corrupting metrics.
- **Smarter raise extraction**: Funding amount extraction uses scored pattern matching to prefer explicit current raise slides over future-plan capital language.
- **Context-aware synergy fallback**: Portfolio synergy summary now produces a company-specific fallback when generic "lack of information" is returned but company context is available.

### Fixed
- ARR metric no longer inherits `annualRevenue` from a mismatched HubSpot company record.
- Location criterion no longer inherits `country` from a mismatched HubSpot company record.
- Funding amount no longer captures future-plan capital raises (e.g., "raise $10M+ for carrier") instead of the current round target.
- Thesis check snapshot no longer contains deck slide-outline fragments, bio text, web search error lines, or spaced-all-caps section markers.
- "Why not fit" field never outputs "No indication of X" absence statements.

## [2.0.1] - 2026-02-16

### Fixed
- **Lead metric extraction**: Tightened regex to only capture investor-specific fields (`lead investor`, `lead vc`, `lead information`) instead of generic `lead` patterns that could match narrative text.
- **Runway field validation**: Added server-side normalization to convert common runway input formats (e.g., `3-6 months`) to HubSpot's exact required options (e.g., `3 - 6 months`) before API submission.
- **Score consistency across views**: List page, detail page, and PDF exports now all use the same client-side score calculation logic that accounts for criterion-level and category-level manual overrides, ensuring displayed scores always match.
- **Overall score persistence**: Criterion-level manual overrides now properly recalculate and persist the overall score to storage when saved.
- **Category score calculation**: Category scores now strictly computed from criterion scores (including criterion-level manual overrides), ignoring legacy category-level override fields to ensure scoring grid math always adds up correctly.
- **PDF answer composition**: PDF exports now use the same dynamic answer templates as the detail page, ensuring answers like market growth and problem necessity display correctly instead of showing raw AI text.
- **Deployment configuration**: Added `APP_PASSWORD` to Cloud Run environment variables in build config to prevent authentication issues after deployments.

## [2.0.0] - 2026-02-15

### Added
- **Integrated scoring research pipeline**
  - Team, Portfolio Synergy, and Problem Necessity research now run automatically before score/rescore.
  - Live progress steps added to new diligence scoring and detail-page rescoring.
  - Category-level re-score action added to scoring grid headers.
- **Market intelligence hardening**
  - TAM and Market Growth fallback estimation expanded with deterministic extraction and sector heuristics.
  - Added sector heuristics for title/real-estate closing workflows (improves sparse-data deals like Pippin Title).
- **HubSpot workflow improvements**
  - HubSpot stage selector available on diligence detail page with write-through sync.
- **Release operations**
  - Added `RELEASE_CHECKLIST.md` for a 10-minute pre-release validation pass.

### Changed
- **Answer and AI-details quality**
  - TAM and Market Growth details now use cleaner prose while preserving method/assumption backup.
  - Team/Synergy/Problem Necessity details shifted from trace-style output to readable sentence-based analysis.
  - Confidence display standardized as percentages in relevant UI contexts.
- **Scoring grid UX**
  - Key metric source provenance moved to hover text (no persistent inline badges).
  - Refresh icon placement aligned in category headers (between score and caret on the right).
- **PDF export alignment**
  - Categories export now reflects the scoring grid structure with `Criterion`, `Answer`, `Score`, and `Details`.
  - Details now prefer user-entered perspective when present, then AI details.
  - Founder names render as clickable links in exported PDFs.
  - Improved pagination and smaller export scale to reduce cutoff and page count.
  - Notes section now exports even when empty (`No notes yet`).

### Fixed
- ARR parsing no longer misreads growth multipliers (for example, `8x`) as currency values.
- Funding amount guardrails prevent cash-on-hand values from being treated as raise amounts.
- Founder-claimed TAM attribution no longer mislabels AI-derived TAM values.
- Business model answer-builder fallbacks now resolve correctly from scoring context.

### Removed
- Scoring-grid manual research controls/boxes for TAM, Team, Portfolio Synergy, and Problem Necessity.

## [1.2.0] - 2026-01-26

### Added
- **Editable Metrics Block**: New metrics section between Overall Score and Category Breakdown
  - Display and edit ARR, TAM, ACV, and YoY Growth Rate
  - Auto-populates from extracted facts and external intelligence
  - Manual overrides persist and serve as source of truth for scoring
  - Compact 2x2 grid layout for space efficiency
- **Intelligent Metric Calculation**:
  - Conservative ARR extraction (excludes projected/forecasted values)
  - YoY Growth Rate computed from historical year-over-year ARR data
  - ACV extraction from explicit evidence only (no fallback calculations)
  - Metrics included in scoring fingerprint for incremental rescore detection
- **Status Management**: Mark diligence records as "In Progress" or "Passed On"
  - Status dropdown on diligence detail page
  - Per-row status selector on main diligence list
  - Status filtering on main list page (defaults to "In Progress" only)
  - Multi-select filter to show one or both statuses
- **Incremental Re-scoring**: Smart re-scoring that skips redundant work
  - Default "Re-score" button performs incremental analysis
  - "Full re-score" option via dropdown menu for forced refresh
  - Fingerprint-based change detection for documents, notes, and metrics
  - Skips scoring when no new information detected
- **Enhanced Scoring Quality**:
  - Natural prose reasoning (removed explicit "Claim/Evidence/Implication" labels)
  - Semantic deduplication for concerns and follow-up questions
  - Override-aware suppression of previously addressed risks
  - Materiality-ranked concerns based on score, confidence, and evidence status
  - Improved concern/question substantiation with evidence linking

### Changed
- Metrics now ground AI scoring as authoritative source of truth
- Re-score explanations include structured narrative with score snapshots, category changes, and material risks
- Scoring version bumped to enforce conservative metric inference
- Status badges now read "Passed On" instead of "Passed"
- Diligence list stats updated to reflect visible (filtered) records

### Fixed
- Over-inference in ACV calculation (removed ARR/customer fallback)
- Projected/forecasted values incorrectly used for ARR and YoY Growth
- Duplicate status labels on detail page
- Reasoning output still using technical template format in some cases

## [1.1.0] - 2026-02-08

### Added
- **Code Refactoring & Architecture**
  - Created custom hooks for diligence record management (`useDiligenceRecord`, `useDiligenceActions`)
  - Added centralized API utility functions (`diligence-api.ts`)
  - Created formatting utilities for common display operations
  - Added common TypeScript types for better type safety
  - New reusable components: `ThesisSection`, `ScoreDisplayCard`
  - Comprehensive refactoring documentation (`REFACTORING.md`)

- **Document link enhancements**
  - Access email field for authentication-required links
  - Copy email to clipboard functionality
  - Visual indicators for links requiring email access
  - Support in both new diligence and detail pages

- **Note improvements**
  - Added title field for individual notes
  - Collapsible/expandable note display
  - Show note title with click-to-expand functionality
  - Simplified notes section header to "Notes"
  - Add Note button always visible in header
  - Backward compatibility for notes without titles

- **Thesis editing capabilities**
  - Edit button for investment thesis fields
  - Manual score override persistence on re-score
  - Visual indicators for edited fields (italic text and colored pen icon)
  - Re-scoring uses edited thesis for context

- **Release Notes Access**
  - Added version number in app footer
  - Clickable version opens release notes modal
  - Full changelog history accessible in-app

### Changed
- Improved code organization and maintainability
- Reduced code duplication through centralized utilities
- Enhanced type safety across the application
- Better separation of concerns in components
- Improved notes UX with collapsible interface
- Enhanced document link workflow with email support
- Better visual feedback for edited content

### Fixed
- Notes section layout and button hierarchy
- Hydration errors with nested buttons
- Note title backward compatibility

### Removed
- Fathom integration (temporarily removed for future implementation)
  - Will be revisited with improved API integration
- Debug/instrumentation logs from production code

## [1.0.0] - 2026-02-04

### Added
- **Diligence Module**: Complete investment diligence workflow
  - Upload documents (PDF, DOCX, PPTX, XLSX) or provide company URLs
  - AI-powered scoring against custom criteria from Google Sheets
  - Web research integration via Serper API for external data
  - Investment thesis generation with problem/solution/ICP analysis
  - Categorized notes system aligned with diligence criteria
  - AI chat interface for discussing companies
  - Document management with Google Drive integration
  - HubSpot deal sync capability
- **Deal Management**: HubSpot integration for deal and partner tracking
  - Sync deals and partners from HubSpot
  - AI-powered VC matching based on investment criteria
  - Deal stage tracking and filtering
  - Company profile views with HubSpot links
- **Email Generation**: AI-powered email composition for deal outreach
  - Select multiple deals to feature
  - Customizable header, footer, and content prompts
  - Rich text editor with formatting support
  - Copy to clipboard functionality
- **Dashboard**: Overview of recent active deals and top diligence scores
- **Authentication**: Password-protected access for team members
  - Simple password authentication (APP_PASSWORD)
  - 30-day session cookies
  - Login page with Mudita branding
- **Google Cloud Deployment**: Production-ready deployment on Cloud Run
  - Automated CI/CD with Cloud Build
  - Google Cloud Storage for persistent data
  - Environment-based configuration (local/production)
  - Auto-scaling from 0 to 3 instances

### Technical
- Next.js 16.1.1 with App Router
- TypeScript for type safety
- OpenAI GPT-4o for AI features
- Google APIs (Drive, Sheets) integration
- HubSpot API integration
- Containerized with Docker
- Deployed on Google Cloud Run

## [Unreleased]

### Added
- **Manual Score Overrides**: Override AI-generated scores for any category
  - Edit category scores with custom values and reasoning
  - Visual indicators showing which scores are manually adjusted
  - Automatic recalculation of overall score with overrides
  - "Revert to AI" functionality to remove overrides
- **Decision Outcome Tracking**: Record investment decisions and performance
  - Track invested/passed/pending decisions with reasons
  - Post-investment performance notes
  - Decision date tracking
- **Learning from Past Decisions**: AI scoring improves based on historical patterns
  - Analyzes past investment decisions to identify what you value
  - Provides context on historical score thresholds
  - Category-level pattern recognition
- **Enhanced HubSpot Integration**: 
  - Intelligent deal stage mapping based on scores
  - Custom property support (diligence_score, diligence_date, diligence_status, etc.)
  - Sync status indicators (not synced, synced, out of sync)
  - "View in HubSpot" button for synced deals
  - Confirmation dialog with preview before syncing
  - Automatic company record creation/update
- **Smarter AI Scoring**:
  - Red flags identification for dealbreakers
  - Competitive differentiation analysis
  - Market timing assessment ("why now")
  - Enhanced founder/team evaluation
  - Investment context awareness

### Changed
- HubSpot sync now includes comprehensive diligence summary with thesis answers
- Sync button shows color-coded status (blue=not synced, green=synced, yellow=needs re-sync)

### Planned
- Individual user accounts with role-based access
- Email notifications for deal updates
- Advanced analytics and reporting
- Mobile-responsive improvements
- Additional data source integrations (Crunchbase, LinkedIn)
