# Diligence Module Setup Guide

## Overview

The Diligence Module is an AI-powered due diligence system that allows you to upload pitch decks and documents, automatically score companies against your investment criteria, and collaborate with AI on investment recommendations.

---

## Features

- Upload multiple documents (PDF, PowerPoint, Word, images)
- Automatic text extraction and analysis
- AI scoring against customizable criteria from Google Sheets
- Interactive AI chat for discussing the diligence
- HubSpot integration (create/update deals with diligence data)
- Document storage in Google Drive
- Comprehensive score breakdown with evidence

---

## Setup Instructions

### Step 1: Google Cloud Setup

#### 1.1 Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Note your Project ID

#### 1.2 Enable APIs

Enable the following APIs for your project:
- Google Drive API
- Google Sheets API

**How to enable:**
1. Go to "APIs & Services" > "Library"
2. Search for each API
3. Click "Enable"

#### 1.3 Create Service Account

1. Go to "APIs & Services" > "Credentials"
2. Click "Create Credentials" > "Service Account"
3. Name it: `diligence-app-service`
4. Grant role: "Editor" (or "Viewer" for Sheets if read-only)
5. Click "Create and Continue" > "Done"

#### 1.4 Generate Service Account Key

1. Click on the service account you created
2. Go to "Keys" tab
3. Click "Add Key" > "Create new key"
4. Choose "JSON" format
5. Download the JSON file (keep it secure!)

#### 1.5 Extract Credentials

Open the downloaded JSON file and copy:
- `client_email` (looks like: `xxxxx@xxxxx.iam.gserviceaccount.com`)
- `private_key` (starts with `-----BEGIN PRIVATE KEY-----`)

---

### Step 2: Google Drive Setup

**⚠️ CRITICAL: You MUST use a Shared Drive, not a regular folder!**

Service accounts cannot upload files to regular Google Drive folders. Choose one of these options:

#### Option A: Shared Drive (Recommended - Requires Google Workspace)

1. Go to [Google Drive](https://drive.google.com)
2. Click **"Shared drives"** in the left sidebar
3. Click **"New"** (+ button) to create a new Shared Drive
4. Name it `Diligence` (or your preferred name)
5. Click **"Add members"**
6. Add your service account email (from step 1.5)
7. Give it **"Content Manager"** or **"Manager"** permissions
8. Copy the Shared Drive ID from the URL:
   - URL format: `https://drive.google.com/drive/folders/SHARED_DRIVE_ID_HERE`
   - Copy the `SHARED_DRIVE_ID_HERE` part

#### Option B: Service Account's Own Drive (Alternative - No Workspace Required)

If you don't have Google Workspace:

1. Set `GOOGLE_DRIVE_FOLDER_ID=root` in your `.env.local` (Step 4)
2. Files will be stored in the service account's own Drive space
3. Files won't appear in your personal Drive, but you can access them via shared links

**For this guide, we recommend Option A if you have Google Workspace.**

---

### Step 3: Google Sheets Setup

#### 3.1 Create Criteria Sheet

1. Create a new Google Sheet
2. Name it: `Diligence Criteria`
3. Set up the structure:

| Category | Weight | Criterion | Description | Scoring Guidance |
|----------|--------|-----------|-------------|------------------|
| Team | 25 | Founder Experience | Years of relevant industry experience | Look for 5+ years in industry, prior exits, domain expertise |
| Team | | Team Completeness | Presence of key roles (CEO, CTO, etc.) | Full C-suite, complementary skills, low turnover |
| Product | 30 | Product-Market Fit | Evidence of customer demand | Strong user growth, low churn, testimonials |
| Product | | Technology Moat | Defensibility of technology | Patents, proprietary data, network effects |
| Market | 25 | Market Size | Total addressable market | $1B+ TAM, growing market, clear path to scale |
| Market | | Competition | Competitive landscape | Differentiated positioning, sustainable advantages |
| Traction | 20 | Revenue Growth | Revenue metrics and growth rate | 3x YoY growth, strong unit economics |
| Traction | | Customer Acquisition | CAC, LTV, and acquisition channels | LTV:CAC > 3:1, diversified channels |

**Important:**
- First row is the header (will be skipped)
- Weight only appears once per category (leave blank for subsequent rows in same category)
- Total weight should equal 100%
- Add as many criteria as needed per category

#### 3.2 Share the Sheet

1. Click "Share" button
2. Add your service account email (same as Drive)
3. Give it "Viewer" permission (read-only)
4. Copy the Sheet ID from the URL:
   - URL format: `https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit`
   - Copy the `SHEET_ID_HERE` part

---

### Step 4: Environment Variables

Update your `.env.local` file with the credentials:

```bash
# Existing variables
HUBSPOT_ACCESS_TOKEN=your_token
NEXT_PUBLIC_HUBSPOT_PORTAL_ID=your_portal_id
OPENAI_API_KEY=your_openai_key

# NEW: Google Cloud credentials
GOOGLE_CLIENT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
YOUR_PRIVATE_KEY_HERE_WITH_NEWLINES
-----END PRIVATE KEY-----"
GOOGLE_DRIVE_FOLDER_ID=your_folder_id_from_step_2
DILIGENCE_CRITERIA_SHEET_ID=your_sheet_id_from_step_3
```

**Important Notes:**
- The `GOOGLE_PRIVATE_KEY` must include the newlines
- Wrap the entire key in double quotes
- Use actual newline characters (not `\n`)

---

### Step 5: Restart Dev Server

After updating `.env.local`:

```bash
# Stop the current dev server (Ctrl+C)
npm run dev
```

---

## Usage Guide

### Creating a New Diligence

1. **Navigate to Diligence**
   - Click "Diligence" in the sidebar
   - Click "New Diligence" button

2. **Enter Company Details**
   - Enter the company name
   - Upload documents (pitch deck, financials, etc.)
   - Click "Upload & Analyze"

3. **AI Processing**
   - Documents are uploaded to Google Drive
   - Text is extracted from each document
   - AI scores the company against your criteria
   - Redirects to detail view when complete

4. **Review Score**
   - View overall score and category breakdown
   - Expand categories to see criterion-level details
   - Review strengths and concerns
   - Read evidence quotes from documents

5. **Discuss with AI**
   - Use the chat interface to ask questions
   - Get deeper insights on specific criteria
   - Discuss concerns or strengths
   - Request recommendations

6. **Add Recommendation**
   - Click "Edit" on the recommendation section
   - Write your investment recommendation
   - Save your notes

7. **Sync to HubSpot**
   - Click "Sync to HubSpot" button
   - Creates or updates a deal in HubSpot
   - Includes score, recommendation, and document links
   - Opens the deal in HubSpot

---

## Troubleshooting

### "Google Drive not configured"

**Issue:** Missing or invalid Google credentials

**Solution:**
1. Verify `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` in `.env.local`
2. Ensure the private key includes newlines
3. Restart dev server after changes

---

### "Google Sheets not configured"

**Issue:** Missing Sheet ID or insufficient permissions

**Solution:**
1. Verify `DILIGENCE_CRITERIA_SHEET_ID` in `.env.local`
2. Ensure service account has "Viewer" access to the sheet
3. Check sheet structure matches expected format

---

### "Failed to parse document"

**Issue:** Document format not supported or corrupted

**Solution:**
1. Verify file extension is supported (PDF, DOCX, PPTX)
2. Try opening the file locally to ensure it's not corrupted
3. For images, text extraction is limited - add text description manually

---

### "Failed to upload to Google Drive"

**Issue:** Permission denied or quota exceeded

**Solution:**
1. Verify service account has "Editor" access to the Drive folder
2. Check Google Drive storage quota
3. Ensure `GOOGLE_DRIVE_FOLDER_ID` is correct

---

## Architecture

```
User uploads documents
  ↓
Stored in Google Drive (organized by company)
  ↓
Text extracted (PDF/DOCX/PPTX parsing)
  ↓
Criteria loaded from Google Sheets
  ↓
AI (GPT-4) scores against criteria
  ↓
Score stored locally (JSON files in data/diligence/)
  ↓
User reviews score and chats with AI
  ↓
Syncs to HubSpot (creates/updates deal)
```

---

## File Storage

### Google Drive Structure

```
Diligence/
  ├── CompanyA/
  │   └── CompanyA_2026-01-26/
  │       ├── pitch_deck.pdf
  │       └── financials.xlsx
  ├── CompanyB/
  │   └── CompanyB_2026-01-27/
  │       └── presentation.pptx
```

### Local Storage

```
data/diligence/
  ├── dd_1738355123456_abc123.json
  ├── dd_1738355234567_def456.json
```

Each JSON file contains the complete diligence record including:
- Company name
- Document metadata (with Drive links)
- Extracted text
- AI score
- Chat history
- Recommendation
- HubSpot deal ID

---

## Cost Considerations

### Google Cloud APIs
- **Drive API:** Free for up to 1 billion requests/day
- **Sheets API:** Free for up to 500 requests/100 seconds per user
- **Storage:** 15GB free with Google account

### OpenAI API
- **GPT-4o:** ~$0.005 per 1K input tokens, ~$0.015 per 1K output tokens
- **Estimated cost per diligence:** $0.50 - $2.00 depending on document size
- **Chat interactions:** ~$0.10 - $0.30 per conversation

---

## Next Steps

### Immediate
1. Complete Google Cloud setup (Steps 1-3)
2. Create your criteria sheet structure
3. Test with a sample document

### Future Enhancements
1. Add OCR for image-based documents (Google Vision API)
2. Export diligence reports as PDF
3. Email notifications for completed diligence
4. Team collaboration features
5. Integrate diligence scores into VC matching algorithm
6. Generate diligence index spreadsheet automatically
7. Version control for document updates
8. Database migration (PostgreSQL/MongoDB)

---

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review console logs for detailed error messages
3. Verify all environment variables are set correctly
4. Ensure Google Cloud permissions are configured properly

---

*Last Updated: January 26, 2026*
*Status: Ready for Setup*
