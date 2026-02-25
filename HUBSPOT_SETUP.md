# HubSpot Custom Properties Setup

This document outlines the custom properties needed in HubSpot for the Diligence module integration.

## Required Custom Properties

### Deal Properties

Create these custom properties in HubSpot (Settings > Properties > Deal Properties):

#### 1. Diligence Score
- **Internal Name**: `diligence_score`
- **Label**: "Diligence Score"
- **Field Type**: Number
- **Description**: "AI-generated diligence score (0-100)"
- **Number Format**: Unformatted number
- **Display in**: Deal record sidebar

#### 2. Diligence Date
- **Internal Name**: `diligence_date`
- **Label**: "Diligence Date"
- **Field Type**: Date picker
- **Description**: "Date when diligence was completed"

#### 3. Diligence Status
- **Internal Name**: `diligence_status`
- **Label**: "Diligence Status"
- **Field Type**: Dropdown select
- **Options**:
  - `in_progress` - "In Progress"
  - `completed` - "Completed"
  - `passed` - "Passed"
  - `declined` - "Declined"
- **Description**: "Current status of diligence review"

#### 4. Diligence Link
- **Internal Name**: `diligence_link`
- **Label**: "Diligence Record"
- **Field Type**: Single-line text
- **Description**: "Link to full diligence record in Deal Flow app"

#### 5. Diligence Data Quality
- **Internal Name**: `diligence_data_quality`
- **Label**: "Diligence Data Quality"
- **Field Type**: Number
- **Description**: "Quality/completeness of diligence data (0-100)"

#### 6. Investment Decision
- **Internal Name**: `investment_decision`
- **Label**: "Investment Decision"
- **Field Type**: Dropdown select
- **Options**:
  - `invested` - "Invested"
  - `passed` - "Passed"
  - `pending` - "Pending Decision"
- **Description**: "Final investment decision"

#### 7. Decision Reason
- **Internal Name**: `decision_reason`
- **Label**: "Decision Reason"
- **Field Type**: Multi-line text
- **Description**: "Reason for investment decision"

## Property Mapping

The app will map internal data to HubSpot properties as follows:

```typescript
// In app/api/diligence/hubspot-sync/route.ts

const dealProperties = {
  dealname: record.companyName,
  description: record.recommendation || 'Diligence completed',
  diligence_score: record.score.overall.toString(),
  diligence_date: record.score.scoredAt,
  diligence_status: record.status,
  diligence_link: `${APP_URL}/diligence/${record.id}`,
  diligence_data_quality: record.score.dataQuality.toString(),
  investment_decision: record.decisionOutcome?.decision,
  decision_reason: record.decisionOutcome?.decisionReason,
  // Add deal stage based on score
  dealstage: determineDealStage(record.score.overall),
};
```

## Deal Stage Mapping

The app will automatically set deal stages based on diligence scores:

| Score Range | Deal Stage | Stage Name |
|------------|------------|------------|
| 80-100 | `dealstage_5` | Deal 5: Due Diligence |
| 60-79 | `dealstage_4` | Deal 4: Pitch |
| 0-59 | `dealstage_8` | Deal 8: Close Lost |

**Note**: Stage IDs may vary by HubSpot portal. Check your pipeline in HubSpot Settings > Objects > Deals > Pipelines.

## Category Score Storage

For detailed category scores, there are two options:

### Option A: Store in Deal Description (Current)
- Pros: No additional setup needed
- Cons: Limited formatting, harder to report on

### Option B: Create Category Properties
Create individual properties for each category:
- `diligence_team_score` (Number)
- `diligence_market_score` (Number)
- `diligence_product_score` (Number)
- etc.

**Recommendation**: Start with Option A, move to Option B if you need reporting/filtering on specific categories.

## Setup Instructions

### 1. Create Custom Properties

1. Go to HubSpot Settings (gear icon)
2. Navigate to Properties > Deal Properties
3. Click "Create property" for each property above
4. Fill in the details exactly as specified
5. Save each property

### 2. Note Internal Names

After creating properties, note the internal names (e.g., `diligence_score`). These are used in the API calls.

### 3. Test the Integration

1. Create a test diligence record in the app
2. Complete scoring
3. Click "Sync to HubSpot"
4. Verify the deal is created/updated with all custom properties
5. Check that values appear correctly in HubSpot

## API Endpoints

The following API endpoints interact with HubSpot:

- `POST /api/diligence/hubspot-sync` - Create or update deal with diligence data
- `GET /api/diligence/check-hubspot` - Check if company exists as deal
- `POST /api/diligence/[id]/decision` - Record investment decision (syncs to HubSpot if `hubspotDealId` exists)

## Troubleshooting

### Properties Not Showing Up

1. Verify property internal names match exactly
2. Check HubSpot API permissions include property write access
3. Try syncing again after a few minutes (HubSpot can have delays)

### Deal Stage Not Updating

1. Check your pipeline configuration in HubSpot
2. Verify deal stage IDs in the code match your pipeline
3. Update `determineDealStage()` function if needed

### Duplicate Deals Created

1. The app searches by deal name before creating
2. If duplicates occur, improve the search logic in `hubspot-sync/route.ts`
3. Consider adding company domain matching

## Future Enhancements

- Two-way sync (update diligence when HubSpot deal changes)
- Webhook integration for real-time updates
- Bulk sync for multiple diligence records
- Automated email notifications when deals are synced
