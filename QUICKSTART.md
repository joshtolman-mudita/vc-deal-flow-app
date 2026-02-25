# Quick Start Guide - HubSpot Integration

Get your VC Deal Flow App connected to HubSpot in 5 minutes!

## ⚡ Fast Track Setup

### Step 1: Install Dependencies (1 min)

```bash
cd d:\vc-deal-flow-app
npm install
```

### Step 2: Get HubSpot Token (2 min)

1. Go to: https://app.hubspot.com/settings/private-apps
2. Click **"Create a private app"**
3. Name it: `VC Deal Flow App`
4. Go to **Scopes** tab
5. Check: ✅ `crm.objects.deals.read`
6. Click **Create app**
7. **Copy the token** that appears

### Step 3: Configure App (1 min)

Create a file named `.env.local` in `d:\vc-deal-flow-app`:

```env
HUBSPOT_ACCESS_TOKEN=paste_your_token_here
```

### Step 4: Start App (1 min)

```bash
npm run dev
```

Open: http://localhost:3000

### Step 5: Sync Deals (30 sec)

1. Click **"Deals"** in the sidebar
2. Click **"Sync from HubSpot"** button
3. ✅ Done! Your deals are now syncing!

---

## 🎯 What You Can Do Now

### Dashboard
- View total deal count
- See active vs shared deals
- Browse recent deals table
- Monitor real-time stats

### Deals Page
- View all deals from HubSpot
- Search by name, industry, or stage
- Filter by industry
- Filter by deal stage
- See deal amounts and dates
- View deal status (Active/Shared/Archived)
- Click to view in HubSpot

### Features Working
✅ Real-time HubSpot sync
✅ Deal search & filtering
✅ Automatic status detection
✅ Error handling & status messages
✅ Loading states
✅ Responsive design

---

## 🔍 Troubleshooting

### "HubSpot is not configured"
- Check `.env.local` exists in `d:\vc-deal-flow-app`
- Verify token is correct
- Restart dev server: `Ctrl+C` then `npm run dev`

### "Invalid access token"
- Token might be wrong - copy it again from HubSpot
- Make sure you selected the `crm.objects.deals.read` scope

### No deals showing
- Check you have deals in HubSpot
- Verify deals aren't archived
- Try clicking "Sync from HubSpot" again

---

## 📚 Next Steps

1. ✅ **Phase 1 Complete**: HubSpot integration working!

2. **Phase 2**: Partner Management
   - Add VC partner profiles
   - Set investment preferences
   - Match deals to partners

3. **Phase 3**: Email Campaigns
   - Create email templates
   - Send deals to partners
   - Automate monthly emails

4. **Phase 4**: Analytics
   - Track email opens/clicks
   - Monitor partner engagement
   - View campaign performance

---

**Need help?** Check [HUBSPOT_SETUP.md](HUBSPOT_SETUP.md) for detailed troubleshooting.

