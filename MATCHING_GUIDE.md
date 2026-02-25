# AI Matching Improvement Guide

## 🎯 Overview

The AI matching system uses GPT-4o-mini to analyze semantic alignment between deals and VC partners. This guide will help you get the best results.

---

## 📊 New Settings Page

Navigate to **Settings** (in the sidebar) to configure:

1. **Custom Matching Guidance** - Specific instructions for the AI
2. **Minimum Match Score** - Filter threshold (30-80%)

### Example Matching Guidance:

```
- Prioritize deals where the founding team has prior startup experience in the industry
- Consider geography less important if the thesis is a strong match (>80% alignment)
- Give extra weight to B2B SaaS companies with proven revenue ($500K+ ARR)
- Fund of Funds should only match with deals at Series A or later stages
- Family Offices prefer sustainable/impact-focused companies with patient capital needs
- Check size is a hard requirement - never show matches outside the stated range
- For deals in healthcare/medtech, prioritize VCs with domain expertise in those fields
```

---

## 📝 HubSpot Data Quality

### For **DEALS** - Critical Fields:

| Field | Importance | Best Practice |
|-------|------------|---------------|
| **Deal Name** | ✅ Required | Company name + context (e.g., "Acme Corp - Series A") |
| **Description** | ⭐ Critical | 100-300 words. Include: what they do, problem solved, key metrics, market size |
| **Industry/Sector** | ⭐ Critical | Be specific (e.g., "Healthcare SaaS" not just "Software") |
| **Deal Stage** | ✅ Required | Auto-populated from pipeline |
| **Deal Amount** | ⭐ Critical | Accurate investment amount needed |
| **Deal Terms** | 🔸 Important | Key terms, valuation, use of funds |
| **Next Steps** | 🔸 Important | Current status, timeline |

#### Optional but Helpful Fields to Add:
- **Company Stage** (e.g., Pre-revenue, $1M ARR, $10M ARR, Profitable)
- **Geography/HQ Location** (City, State/Country)
- **Key Metrics** (ARR, growth rate, customer count, burn rate)
- **Founder Background** (Prior experience, domain expertise)
- **Use of Funds** (What they'll do with the investment)

### For **VC PARTNERS** - Critical Fields:

| Field | Importance | Best Practice |
|-------|------------|---------------|
| **Company Name** | ✅ Required | VC firm name |
| **Type** | ✅ Required | VC/PE/Debt, VC, Family Office, Fund of Funds |
| **VC: Thesis** | ⭐⭐⭐ MOST CRITICAL | 100-500 words. Be VERY specific about what they look for |
| **VC Investment Space** | ⭐ Critical | Specific industries (e.g., "Healthcare IT, Telemedicine, Digital Health") |
| **VC: Investment Stage** | ⭐ Critical | Stages they invest in (Seed, Series A, etc.) |
| **VC Check Size** | ⭐ Critical | Investment range |
| **VC: Regions of Investment** | 🔸 Important | Geographic focus |

#### Example of a GREAT Investment Thesis:

```
We invest in B2B SaaS companies solving critical workforce challenges in 
large industries like healthcare, logistics, and construction. We look for:
- Companies with 2-3 years of customer traction ($1M+ ARR)
- Strong founding teams with 10+ years of domain expertise
- Clear ROI proposition for enterprise customers
- Defensible IP or network effects
- Markets with $5B+ TAM

We DON'T invest in:
- Consumer apps or marketplaces
- Hardware or biotech
- Pre-revenue companies
- Companies requiring >$10M to reach profitability
```

#### Example of a WEAK Investment Thesis:
```
"We invest in technology companies" ❌ Too vague!
```

#### Optional but Helpful Fields to Add:
- **Past Investments** (Examples of companies they've funded)
- **Key Focus Areas** (AI, blockchain, climate tech, etc.)
- **Investment Criteria** (Minimum revenue, team size, etc.)
- **Red Flags/Exclusions** (What they won't invest in)

---

## 🎯 Matching Algorithm Overview

### Level 1: Hard Filters (Must Pass)
- ✅ **Check Size** - Deal amount must fit VC's stated range
- ✅ **Investment Stage** - Deal stage must match VC's preferences
- ⚠️ **Geography** (Optional) - Can be configured via custom guidance

### Level 2: AI Semantic Matching (Scored 0-100)
- 🧠 **Industry/Space Alignment** - How well does the deal fit the VC's focus areas?
- 🧠 **Thesis Alignment** - Does the deal match the VC's investment philosophy?
- 🧠 **Stage Fit** - Is the company at the right maturity level?
- 🧠 **Strategic Fit** - Other factors like team, market, technology

---

## 💡 Tips for Better Matches

### 1. **Quality over Quantity**
- One detailed, specific investment thesis is worth 10 vague ones
- 200 words of good description > 50 words of generic info

### 2. **Use Specific Language**
- ✅ "B2B workflow automation for healthcare providers"
- ❌ "Technology company"

### 3. **Include Context**
- Mention competitors, market trends, unique advantages
- Reference specific problems being solved

### 4. **Keep Data Fresh**
- Update deal descriptions as companies evolve
- Refresh VC theses when investment focus shifts

### 5. **Test and Iterate**
- Run matches on a few deals
- Review the AI reasoning
- Adjust your custom guidance based on results
- Update HubSpot data where gaps are found

---

## 🔍 Troubleshooting

### "No matches found"
- ✅ Check your minimum match score (try lowering it)
- ✅ Review hard filters (check size, stage) - they might be too restrictive
- ✅ Make sure VC partners have detailed investment theses

### "Matches don't make sense"
- ✅ Add custom matching guidance to specify your criteria
- ✅ Check if HubSpot data is specific enough (avoid generic descriptions)
- ✅ Review AI reasoning in the match results to understand the logic

### "Missing good matches"
- ✅ Lower the minimum match score temporarily
- ✅ Check if hard filters are excluding good candidates
- ✅ Ensure deal descriptions include key terms that VCs look for

---

## 📈 Continuous Improvement

1. **Review Match Results** - Click "Match" and read the AI reasoning
2. **Update Guidance** - Refine your custom matching guidance based on patterns
3. **Improve Data** - Identify deals/VCs with weak descriptions and enhance them
4. **Monitor Patterns** - Notice which matches work best and replicate that data quality

---

## 🚀 Next Steps

1. Go to **Settings** and add your custom matching guidance
2. Review 5-10 deals in HubSpot and enhance their descriptions
3. Review 5-10 VC partners and improve their investment theses
4. Run some test matches and review the results
5. Iterate on your guidance based on what you learn

---

## ❓ Questions?

The AI matching system learns from the guidance you provide and the data quality in HubSpot. The more specific and detailed you are, the better the matches will be!


