# Web Search & Scraping Setup Guide

Your diligence module now has two powerful features for accessing current web data:

## 🌐 Feature 1: Website Scraping (Already Working!)

When you provide a company URL, the system automatically:
- Fetches the company's website content
- Extracts text from the homepage
- Includes this in the AI analysis

**No setup required** - this works out of the box!

## 🔍 Feature 2: Web Search (Requires API Key)

The system can perform automated web searches to find:
- Recent funding news and announcements
- Competitor information and market analysis
- Product features and customer reviews
- TAM/SAM estimates and market data

### Setup Instructions:

1. **Get a Free Serper API Key**
   - Go to: https://serper.dev/
   - Sign up for a free account
   - Free tier includes: **2,500 searches/month**
   - Copy your API key

2. **Add API Key to Environment**
   - Open `.env.local` in your project root
   - Find the line: `SERPER_API_KEY=your_serper_api_key_here`
   - Replace `your_serper_api_key_here` with your actual API key
   - Save the file

3. **Restart the Development Server**
   ```bash
   npm run dev
   ```

### Usage:

Once configured, the system automatically performs **3 web searches** per diligence:

1. **Funding & News**: `"{company_name}" funding news 2024`
2. **Market & Competitors**: `"{company_name}" competitors market analysis`
3. **Product & Customers**: `"{company_name}" product features customers`

### Cost Estimate:

- **3 searches per diligence record** (initial scoring)
- **3 searches per re-score** (when you click "Re-score")
- **Free tier**: 2,500 searches/month = ~800 diligence analyses
- **Paid plan**: $50/month for 50,000 searches = ~16,000 analyses

### How It Works:

The system adds web search results as a special document type called "Current Web Research & News" that includes:
- Recent search results from Google
- Snippets and summaries
- Source URLs and dates
- Clear indication that this is current data (not AI training data)

### Benefits:

✅ **Current Information**: Gets data published after the AI's training cutoff
✅ **Market Context**: Finds competitor analysis and market sizing
✅ **Verification**: Cross-references pitch deck claims with public data
✅ **News & Traction**: Discovers recent funding, customers, or partnerships
✅ **Comprehensive**: Combines website scraping + search results for complete picture

### What If I Don't Configure It?

If you don't add a Serper API key:
- Website scraping still works (free!)
- Web searches are skipped (you'll see a console log message)
- Analysis proceeds with available data only
- No errors or failures

### Troubleshooting:

**Issue**: Web searches not working
- Check `.env.local` has the correct API key
- Restart the dev server after adding the key
- Check console logs for error messages
- Verify API key at https://serper.dev/dashboard

**Issue**: "Rate limit exceeded"
- You've used your monthly quota
- Upgrade to paid plan or wait until next month
- System will continue working with just website scraping

**Issue**: Search results seem irrelevant
- Check company name is spelled correctly
- Try adding more context in "Company Description"
- The AI will filter and focus on relevant information

### Privacy & Data:

- Searches are performed server-side
- Company information is sent to Serper API for searching
- Serper uses Google Search, so results are public information
- No private pitch deck data is sent to search APIs

---

**Need Help?** Check the console logs in your terminal for detailed information about what's being fetched and searched.
