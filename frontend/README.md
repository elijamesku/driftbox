# Infrara Landing Page

A modern, techy landing page for Infrara with a Warp/Cursor-inspired aesthetic.

## Features

- 🎨 Dark theme with animated gradient meshes
- 📧 Email signup with Supabase storage
- ✨ Smooth animations with Framer Motion
- 🎯 Optimized for DevOps audiences
- 📱 Fully responsive

## Setup

1. **Install dependencies:**
```bash
npm install
```

2. **Set up Supabase:**
   - Create a new Supabase project
   - Run the SQL schema in your Supabase SQL editor:
   
```sql
create table waitlist (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  metadata jsonb
);
```

3. **Configure environment variables:**
   - Copy `.env.local.example` to `.env.local`
   - Add your Supabase credentials

4. **Run the development server:**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see your landing page.

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- Framer Motion
- Supabase

## Project Structure

```
frontend/
├── app/
│   ├── api/signup/route.ts  # API endpoint for email signups
│   ├── globals.css          # Global styles and animations
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Main landing page
├── components/
│   ├── CTASection.tsx       # Final call-to-action
│   ├── Features.tsx         # Features grid
│   ├── GradientBackground.tsx # Animated gradient canvas
│   ├── Hero.tsx             # Hero section
│   ├── HowItWorks.tsx       # 3-step flow
│   └── SignupForm.tsx       # Email signup form
└── lib/
    └── supabase.ts          # Supabase client

