Career Crox Interns CRM setup

1. Create a new GitHub repository:
   - Suggested repo name: career-crox-interns-crm

2. Create a new Supabase project:
   - Project display name: Career Crox Interns

3. In Supabase:
   - Go to SQL Editor
   - Run docs/SUPABASE_SCHEMA.sql

4. Import the seed workbook:
   - python tools/import_excel_to_supabase.py

5. Create a new Render web service from the GitHub repo

6. In Render, add environment variables:
   - SECRET_KEY
   - SUPABASE_URL
   - SUPABASE_ANON_KEY
   - SUPABASE_SERVICE_ROLE_KEY

7. Deploy

What key goes where

- GitHub:
  no runtime key needed for the app itself

- Supabase:
  SUPABASE_URL
  SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY

- Render:
  same 4 environment variables above, inside the service settings

Expected result

- Remote employees add/update data in the CRM
- Data is stored centrally in Supabase
- When you add data through the UI, it shows for all users hitting the same Supabase project
- When you import your workbook once, the login IDs and passwords become available in the CRM
