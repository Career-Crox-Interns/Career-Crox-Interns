# Career Crox Interns CRM

Genz-styled Flask CRM with the same interface, but prepared for:

- Supabase as the central data store
- Render for hosting
- GitHub for code deployment
- SQLite only as a local preview fallback when Supabase keys are not set

## What changed

- Old spreadsheet dependency removed from the working path
- Supabase-ready backend added through REST API
- User theme selection is saved per user
- Modal create flows now save:
  - Candidate
  - Task
  - JD
  - Interview
- Internal chat, notes, notifications, impersonation, dashboard, dialer view kept

## Local preview

```bash
pip install -r requirements.txt
python app.py
```

If Supabase keys are missing, the app will run in local preview mode using the bundled seed workbook.

## Supabase setup

1. Create a new Supabase project
2. Open SQL Editor
3. Run `docs/SUPABASE_SCHEMA.sql`
4. Import the seed workbook with:

```bash
python tools/import_excel_to_supabase.py
```

5. Add the keys to `.env` or Render environment variables

## Required environment variables

- `SECRET_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Render

Use:

- Build command: `pip install -r requirements.txt`
- Start command: `gunicorn app:app`

## Seed workbook

The default seed file is:

`sample_data/Career_Crox_Interns_Seed.xlsx`

It contains Users, Candidates, Tasks, Notifications, JD_Master, and Settings in the same format you uploaded.

## Important

- `SUPABASE_SERVICE_ROLE_KEY` must stay server-side only
- Do not commit a real `.env` file to GitHub
- Keep the repository private until deployment is stable
