# VC Deal Flow App

A modern deal flow sharing application for venture capital partners. Connect to HubSpot to find and share deals with external partners via email campaigns.

## Features

- 📊 **Dashboard**: Overview of deal flow activity and key metrics
- 🏢 **Deal Management**: Sync and filter deals from HubSpot
- 👥 **Partner Management**: Manage VC partners and their investment preferences
- 📧 **Email Campaigns**: Create automated monthly email campaigns
- 📈 **Analytics**: Track engagement and campaign performance
- ⚙️ **Settings**: Configure HubSpot integration and preferences

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **Language**: TypeScript
- **Icons**: Lucide React
- **Future Integrations**: HubSpot API, Email Service

## Getting Started

### Prerequisites

Make sure you have Node.js (v18 or higher) installed on your system.

### Installation

1. Install dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
```

2. Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

3. Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## Project Structure

```
vc-deal-flow-app/
├── app/                    # Next.js app directory
│   ├── deals/             # Deals page
│   ├── partners/          # Partners page
│   ├── campaigns/         # Email campaigns page
│   ├── analytics/         # Analytics page
│   ├── settings/          # Settings page
│   ├── layout.tsx         # Root layout
│   ├── page.tsx           # Dashboard page
│   └── globals.css        # Global styles
├── components/            # React components
│   ├── DashboardLayout.tsx
│   ├── Sidebar.tsx
│   └── Header.tsx
└── public/               # Static assets
```

## Roadmap

### Phase 1: Foundation ✅
- [x] Initialize Next.js with Tailwind CSS
- [x] Create dashboard layout with navigation
- [x] Set up basic routing structure

### Phase 2: HubSpot Integration ✅
- [x] Connect to HubSpot API
- [x] Fetch and display deals
- [x] Implement deal filtering and search
- [x] Sync deal data
- [x] Real-time dashboard stats

### Phase 3: Partner Management (Coming Soon)
- [ ] Create partner profiles
- [ ] Define investment preferences
- [ ] Track partner interactions

### Phase 4: Email Campaigns (Coming Soon)
- [ ] Design email templates
- [ ] Create campaign builder
- [ ] Implement automated monthly sends
- [ ] Track email engagement

### Phase 5: Analytics (Coming Soon)
- [ ] Campaign performance metrics
- [ ] Partner engagement tracking
- [ ] Deal flow analytics

## Environment Variables

Create a `.env.local` file in the root directory:

```env
# HubSpot Configuration (Coming Soon)
HUBSPOT_API_KEY=your_api_key_here
HUBSPOT_PORTAL_ID=your_portal_id_here

# Email Service Configuration (Coming Soon)
EMAIL_SERVICE_API_KEY=your_email_api_key_here
```

## Contributing

This is a private project for venture capital deal flow management.

## License

Private - All Rights Reserved



