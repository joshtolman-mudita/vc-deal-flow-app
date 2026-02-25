# Diligence Module - Testing Guide

## Pre-Testing Setup Checklist

Before testing, ensure:

- [ ] All npm packages installed successfully
- [ ] Google Cloud service account created
- [ ] Google Drive API enabled
- [ ] Google Sheets API enabled  
- [ ] `.env.local` has all Google credentials
- [ ] Diligence folder created in Google Drive
- [ ] Diligence folder shared with service account (Editor access)
- [ ] Criteria Google Sheet created with proper structure
- [ ] Criteria sheet shared with service account (Viewer access)
- [ ] Dev server restarted after adding env variables

---

## Test Cases

### Test 1: Basic Navigation

**Steps:**
1. Go to http://localhost:3000
2. Click "Diligence" in the sidebar
3. Verify diligence list page loads

**Expected Result:**
- ✅ "Due Diligence" page displays
- ✅ "New Diligence" button visible
- ✅ Empty state shows if no records exist

---

### Test 2: Create New Diligence (Happy Path)

**Steps:**
1. Click "New Diligence" button
2. Enter company name: "Test Company Inc"
3. Upload a PDF pitch deck
4. Click "Upload & Analyze"

**Expected Result:**
- ✅ Upload progress shows
- ✅ Files uploaded to Google Drive
- ✅ Thesis-first pass is available/runs via **Check Thesis** flow
- ✅ Redirects into diligence workflow without creating duplicate records
- ✅ Full score is only produced after explicit **Score Company**

**Common Issues:**
- If "Google Drive not configured": Check `.env.local` credentials
- If "Failed to upload": Verify service account has Editor access to folder
- If "Failed to score": Check OpenAI API key and quota

---

### Test 2.5: Thesis Check -> Full Scoring (Canonical Path)

This is the critical path for current product behavior.

**Steps:**
1. Create a new diligence for a company (example: Summoner).
2. Upload exactly 2 documents (one deck + one supporting doc).
3. Click **Check Thesis** and wait for thesis result.
4. Add optional thesis feedback.
5. Click **Score Company** and complete any HubSpot create/link modal flow.
6. Let full scoring finish and open detailed diligence page.

**Expected Result:**
- ✅ Same `diligenceId` is used from thesis check to full score (no duplicate diligence record created)
- ✅ Document count does not multiply unexpectedly from repeated folder scans
- ✅ `score` and `metrics` are both persisted after full scoring
- ✅ Team section reflects identified founders when founder records exist

**Verify in logs (if debugging enabled):**
- `diligence-score][documents_dedupe` shows stable before/after counts
- `diligence-score][metrics_before_persist` and `metrics_after_persist` include expected metric keys
- `hubspot-create-commit][persisted_metric_snapshot` reflects mapped deal terms/runway values

---

### Test 3: Multiple Document Types

**Steps:**
1. Create new diligence
2. Upload multiple files:
   - PDF pitch deck
   - PowerPoint presentation
   - Word document
   - Text file

**Expected Result:**
- ✅ All files upload successfully
- ✅ Text extracted from each document
- ✅ AI analyzes all documents together
- ✅ Score considers all information

---

### Test 4: Score Breakdown

**Steps:**
1. Open a completed diligence
2. Review overall score
3. Click on each category to expand
4. Review criterion-level details

**Expected Result:**
- ✅ Overall score displays prominently
- ✅ Category scores match criteria sheet weights
- ✅ Each criterion shows score, reasoning, and evidence
- ✅ Strengths and concerns are listed
- ✅ Data quality percentage shown

---

### Test 4.5: Key Metrics Grid Mapping Integrity

**Steps:**
1. Run full score flow on a record with known metrics in deck/notes.
2. Open detailed diligence page and inspect the Key Metrics grid.
3. Run a re-score and inspect again.

**Expected Result:**
- ✅ `TAM` appears if known from either:
  - extracted metrics,
  - HubSpot TAM field,
  - or external-market-intel TAM fallback.
- ✅ `Current Runway` and `Post Runway Funding` persist if entered/mapped from HubSpot create flow.
- ✅ Re-score does not blank previously known metrics unless explicitly overwritten.

---

### Test 5: AI Chat Interaction

**Steps:**
1. Open a completed diligence
2. In chat panel, ask: "What are the main concerns about this investment?"
3. Wait for response
4. Ask follow-up: "How can they address the market competition issue?"

**Expected Result:**
- ✅ Messages stream in real-time
- ✅ AI provides contextual answers based on documents
- ✅ Chat history persists
- ✅ Can scroll through conversation

---

### Test 6: Add Recommendation

**Steps:**
1. Open a completed diligence
2. Click "Edit" on Recommendation section
3. Enter: "Strong pass - exceptional team with proven PMF"
4. Click "Save"

**Expected Result:**
- ✅ Recommendation saves successfully
- ✅ Can edit again if needed
- ✅ Recommendation persists after page refresh

---

### Test 7: HubSpot Sync

**Steps:**
1. Open a completed diligence with score
2. Click "Sync to HubSpot"
3. Wait for sync

**Expected Result:**
- ✅ Success message appears
- ✅ HubSpot deal link opens in new tab
- ✅ Deal contains score information
- ✅ Deal has document links
- ✅ Diligence record updates with deal ID

---

### Test 8: Data Persistence

**Steps:**
1. Create a diligence record
2. Close browser tab
3. Reopen application
4. Navigate back to diligence list

**Expected Result:**
- ✅ Record still exists
- ✅ All data preserved (score, chat, documents)
- ✅ Documents still accessible in Google Drive

---

### Test 9: Error Handling

**Test 9a: Missing Credentials**
1. Remove `GOOGLE_CLIENT_EMAIL` from `.env.local`
2. Restart dev server
3. Try to create new diligence

**Expected Result:**
- ✅ Clear error message about missing configuration
- ✅ Application doesn't crash

**Test 9b: Invalid File Type**
1. Try to upload a .exe or .zip file

**Expected Result:**
- ✅ File rejected (not in accepted types)
- ✅ Clear error message

**Test 9c: Large File**
1. Try to upload a 60MB file

**Expected Result:**
- ✅ Warning shown about file size
- ✅ Upload may fail gracefully

---

### Test 10: Mobile Responsiveness

**Steps:**
1. Open application on mobile device or resize browser to mobile width
2. Navigate through diligence flow

**Expected Result:**
- ✅ Layout adjusts for mobile
- ✅ All buttons and forms accessible
- ✅ Tables scroll horizontally
- ✅ Chat interface usable

---

## Performance Testing

### Document Parsing Speed

Test with various file sizes:
- Small PDF (< 1MB): ~1-2 seconds
- Medium PDF (5MB): ~3-5 seconds
- Large PDF (20MB): ~10-15 seconds
- PowerPoint (10MB): ~5-10 seconds

### AI Scoring Speed

Depends on:
- Number of documents
- Total text length
- Number of criteria

Expected: 30-90 seconds for typical diligence (3-5 documents)

### Chat Response Time

- Streaming starts: < 1 second
- Full response: 5-15 seconds depending on complexity

---

## Validation Checklist

### Data Quality
- [ ] Text extraction quality is good (readable, formatted)
- [ ] AI scores are reasonable and justified
- [ ] Evidence quotes match document content
- [ ] Data quality assessment is accurate

### User Experience
- [ ] Forms are intuitive
- [ ] Loading states are clear
- [ ] Error messages are helpful
- [ ] Navigation is smooth
- [ ] No UI jank or lag

### Integration
- [ ] Google Drive folders created correctly
- [ ] Documents accessible via Drive links
- [ ] HubSpot deals created/updated properly
- [ ] Deal contains all diligence information

### Security
- [ ] Service account has minimal necessary permissions
- [ ] No credentials exposed in UI
- [ ] File upload size limits enforced
- [ ] Only supported file types accepted

---

## Known Limitations (MVP)

1. **Image OCR:** Images show placeholder text (no OCR in MVP)
2. **Database:** Uses local file storage (JSON files)
3. **Concurrency:** No locking mechanism for simultaneous edits
4. **File versioning:** No version control for document updates
5. **Batch operations:** Can't score multiple companies at once
6. **Export:** No PDF report generation yet
7. **Notifications:** No email alerts
8. **Collaboration:** Single-user system (no team features)

---

## Debugging Tips

### Enable Detailed Logging

Use existing runtime debug hooks (already wired):
- `diligence-score][documents_dedupe`
- `diligence-score][metrics_before_persist`
- `diligence-score][metrics_after_persist`
- `diligence-score][tam_fallback_applied`
- `diligence-rescore][documents_after_refresh`
- `diligence-rescore][metrics_before_persist`
- `diligence-rescore][metrics_after_persist`
- `hubspot-create-commit][resolved_metric_candidates`
- `hubspot-create-commit][persisted_metric_snapshot`

For duplicate-doc triage specifically:
- Compare Drive folder file count vs persisted record document count.
- Inspect dedupe signatures for repeated keys.
- If duplicates remain, check filename/path normalization differences.

### Check Google API Errors

Common issues:
- **403 Forbidden:** Service account doesn't have permission
- **404 Not Found:** Folder/Sheet ID incorrect
- **401 Unauthorized:** Credentials invalid or expired

### Verify Data Storage

Check files in `data/diligence/`:
```bash
ls -la data/diligence/
cat data/diligence/dd_*.json
```

### Monitor OpenAI Usage

Check OpenAI dashboard for:
- API usage and costs
- Rate limit errors
- Token consumption per request

---

## Success Criteria

A successful test means:

1. ✅ Can create new diligence
2. ✅ Documents upload and parse correctly  
3. ✅ AI scoring produces reasonable results
4. ✅ Can chat with AI about the analysis
5. ✅ Can add and save recommendations
6. ✅ Can sync to HubSpot successfully
7. ✅ Data persists across sessions
8. ✅ No TypeScript or runtime errors

---

## Next Steps After Testing

1. **Fine-tune AI prompts** based on scoring quality
2. **Adjust criteria** in Google Sheet if needed
3. **Add more test data** to validate consistency
4. **Plan Phase 2 features** (OCR, database, reports, etc.)
5. **Document actual workflows** based on real usage

---

*Testing Status: Ready for QA*
*Last Updated: January 26, 2026*
