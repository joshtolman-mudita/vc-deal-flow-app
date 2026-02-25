# Diligence Module - Quick Start

## 5-Minute Setup

### 1. Google Cloud (2 min)
```
1. Go to console.cloud.google.com
2. Create service account
3. Download JSON key
4. Enable Drive API + Sheets API
```

### 2. Google Drive (1 min)
```
1. Create "Diligence" folder
2. Share with service account (Editor)
3. Copy folder ID from URL
```

### 3. Google Sheet (1 min)
```
1. Create "Diligence Criteria" sheet
2. Add structure: Category | Weight | Criterion | Description | Guidance
3. Share with service account (Viewer)
4. Copy sheet ID from URL
```

### 4. Environment Variables (1 min)
```bash
# Add to .env.local:
GOOGLE_CLIENT_EMAIL=xxx@xxx.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
GOOGLE_DRIVE_FOLDER_ID=folder_id_here
DILIGENCE_CRITERIA_SHEET_ID=sheet_id_here
```

### 5. Restart Server
```bash
npm run dev
```

---

## First Diligence (2 min)

1. Click **"Diligence"** in sidebar
2. Click **"New Diligence"**
3. Enter company name
4. Upload pitch deck (PDF/PPT)
5. Click **"Upload & Analyze"**
6. Wait 30-60s for AI scoring
7. Review score breakdown
8. Chat with AI about the analysis
9. Click **"Sync to HubSpot"**

---

## Criteria Sheet Template

Copy this to your Google Sheet:

| Category | Weight | Criterion | Description | Scoring Guidance |
|----------|--------|-----------|-------------|------------------|
| Team | 25 | Founder Experience | Years in industry | 5+ years = 80+, 10+ = 90+ |
| Team | | Team Completeness | Key roles filled | Full C-suite = 80+ |
| Product | 30 | Product-Market Fit | Customer demand | Strong growth = 80+ |
| Product | | Technology | Defensibility | Patents/IP = 80+ |
| Market | 25 | Market Size | TAM | $1B+ = 80+ |
| Market | | Competition | Positioning | Clear differentiator = 80+ |
| Traction | 20 | Revenue | Growth rate | 3x YoY = 80+ |
| Traction | | Unit Economics | LTV:CAC ratio | >3:1 = 80+ |

**Note:** Weights must total 100%

---

## Troubleshooting

### Error: "Google Drive not configured"
→ Check `GOOGLE_CLIENT_EMAIL` and `GOOGLE_PRIVATE_KEY` in `.env.local`  
→ Restart dev server

### Error: "Failed to upload"
→ Verify service account has Editor access to Drive folder  
→ Check folder ID is correct

### Error: "Failed to score"
→ Check OpenAI API key  
→ Verify you have API credits

### Error: "No data found in criteria sheet"
→ Check sheet ID is correct  
→ Verify service account has Viewer access  
→ Ensure sheet has data (not just header)

---

## Navigation

**URL Structure:**
- `/diligence` - List all diligence
- `/diligence/new` - Create new
- `/diligence/[id]` - View details

**Sidebar:** "Diligence" with FileSearch icon

---

## Tips

1. **Best Documents:** Pitch deck + financials + cap table
2. **File Naming:** Use descriptive names (helps AI context)
3. **Multiple Files:** Upload all at once for better analysis
4. **Chat Usage:** Ask specific questions about criteria
5. **Recommendations:** Be specific - include next steps

---

**Status:** Ready to use after setup  
**Time to First Diligence:** ~10 minutes (including setup)
