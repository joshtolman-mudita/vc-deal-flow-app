# Setup Guide

## Quick Start

### 1. Install Node.js

If you don't have Node.js installed, download it from [nodejs.org](https://nodejs.org/) (LTS version recommended).

Verify installation:
```bash
node --version
npm --version
```

### 2. Install Dependencies

Open a terminal in the project directory and run:

```bash
npm install
```

This will install all required packages including:
- Next.js 14
- React 18
- Tailwind CSS
- TypeScript
- Lucide React (for icons)

### 3. Run Development Server

Start the development server:

```bash
npm run dev
```

The application will be available at [http://localhost:3000](http://localhost:3000)

### 4. Build for Production

To create a production build:

```bash
npm run build
npm start
```

## Project Overview

### Current Features
- ✅ Modern dashboard with navigation sidebar
- ✅ Responsive layout with Tailwind CSS
- ✅ Six main pages: Dashboard, Deals, Partners, Campaigns, Analytics, Settings
- ✅ TypeScript support
- ✅ Clean, professional UI

### Next Steps for Development

#### Phase 1: HubSpot Integration
1. Get HubSpot API credentials
2. Install HubSpot SDK: `npm install @hubspot/api-client`
3. Create API routes in `app/api/hubspot/`
4. Implement deal fetching and filtering

#### Phase 2: Partner Management
1. Create partner database schema
2. Build partner CRUD operations
3. Implement preference matching algorithm

#### Phase 3: Email System
1. Choose email service (SendGrid, Resend, etc.)
2. Design email templates
3. Implement campaign scheduler
4. Add tracking and analytics

## Troubleshooting

### Port Already in Use
If port 3000 is already in use, you can specify a different port:
```bash
npm run dev -- -p 3001
```

### TypeScript Errors
Run the TypeScript compiler to check for errors:
```bash
npx tsc --noEmit
```

### Clear Cache
If you encounter build issues:
```bash
rm -rf .next
npm run dev
```

## Environment Setup

Create a `.env.local` file for environment variables:

```env
# HubSpot
HUBSPOT_API_KEY=your_key_here
HUBSPOT_PORTAL_ID=your_portal_id

# Email Service
EMAIL_SERVICE_API_KEY=your_key_here

# Database (when needed)
DATABASE_URL=your_connection_string
```

## Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
- [HubSpot API Documentation](https://developers.hubspot.com/docs/api/overview)
- [Lucide Icons](https://lucide.dev/)



