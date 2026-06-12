# SEO OPS Command Center

A modern SaaS platform for SEO agencies and clients, featuring a dark-themed dashboard, task management, and AI-driven insights.

## Features

- **Dashboard**: Real-time SEO metrics (Impressions, Clicks, Rankings).
- **Tasks**: Kanban-style board for tracking deliverables.
- **Reports**: Monthly performance summaries with AI insights.
- **Settings**: User profile and notification preferences.
- **UI**: High-end dark mode with neon gradient accents.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS v4
- **Icons**: Lucide React
- **Database**: Supabase (Schema provided in `schema.sql`)

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Run Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view the app.

3. **Build for Production**:
   ```bash
   npm run build
   npm start
   ```

## Project Structure

- `/app`: Next.js App Router pages.
- `/components`: Reusable UI components (Dashboard, Tasks, etc.).
- `/lib`: Utility functions and mock data.
- `schema.sql`: Database schema for Supabase.

## Deployment

This project is ready to be deployed on **Vercel**.
1. Push to GitHub.
2. Import project in Vercel.
3. Add environment variables (if connecting to real Supabase instance).
4. Deploy.

## Security Workflow

See [`docs/security/README.md`](docs/security/README.md) for the Codex-powered DevSecOps workflow, reusable review prompts, GitHub/Vercel/Supabase checklists, privacy data map, scheduled review cadence, and vulnerability triage rules.

Local security checks:

```bash
npm run security:all
```
