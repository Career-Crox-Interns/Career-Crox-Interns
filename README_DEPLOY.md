# Deploy Career Crox CC834

Upload `frontend/` first, then all other items from this folder into the same repository root. Do not upload the `GITHUB`, `ALL_BACKEND` or `DESKTOP_CRM` wrapper as an extra repository directory.

Render uses Node 24. Build: `npm run render-build`. Start: `npm start`. This build generates `backend/public/spa` and the release manifest; those generated files are not GitHub upload files.

Supabase SQL, Android, local preview and credentials stay in their separate folders. Existing database: use SAFE_UPGRADE_WITH_USERS or both SAFE_UPGRADE parts. Never run FULL_RESET for an ordinary update.
