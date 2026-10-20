# Career Crox CC875

This is the CC874 Project Multiple CRM source with dashboard viewing, organized reminders and popup preferences added. Upload all files from this GITHUB folder to your repository root. Frontend: 97 source files; backend and all other root files combined: 97. Generated SPA/assets and dependencies are rebuilt automatically.

Use Node.js 24. Build: `npm run render-build`. Start: `npm start`. Keep existing database, JWT and Storage credentials private. Deploy frontend and backend together, then refresh the browser.

CC875 dashboard/reminder controls use existing CRM tables and personal browser preferences. They do not introduce new database tables or new periodic network polling. If the full CC874 control/schema is already installed, no new SQL is required for these controls. For an existing earlier CRM, run DESKTOP_CRM/SUPABASE/FOR_FIRST_CRM/01_SAFE_UPGRADE_KEEP_DATA.sql. It preserves business data and existing instance identity/mode. Use the full file OR its two parts in order.

FOR_SECOND_CRM and FOR_THIRD_CRM bootstrap only a new, empty project and intentionally refuse existing business rows. Never use a reset SQL file for an upgrade or routine switch. Old schema files are historical references inside LEGACY_REFERENCE_DO_NOT_RUN.

Whole recovery needs independent provider credentials, an instance secret of at least 32 random characters, a separate local recovery owner, a four-digit PIN and an offline RSA-3072 recovery key. Set CC874_INSTANCE_SECRET, CC874_RECOVERY_USERNAME and CC874_RECOVERY_PASSWORD_HASH on each instance. Generate the owner hash locally with `node scripts/create-first-manager.mjs --recovery-owner-hash`. Keep the private recovery key offline; only the public key is registered. Node 24 provides the encrypted local-base index support.

Manager: use Switch dashboard to view any TL/recruiter. TL: choose an allowed team recruiter. My dashboard shows only your own work; overview restores the existing team/all view. Another employee's dashboard is a view-only data scope; your login, attendance and administrative identity remain yours.

Settings > Popups & reminders controls team popups (managers), auto-hide (10 seconds by default), stay-open mode and duration (1-300 seconds). The Reminders list retains hidden popups and offers categories, search, open, snooze and dismiss. Access/office locks and required recovery confirmations do not auto-dismiss.

The included Android source remains CC873 / versionCode 278. The web release is CC875. No APK was compiled in this run. Open ANDROID/OPEN ANDROID STUDIO.bat for the retained build workflow. LOCAL_TEST is separate and uses local test accounts, never production Supabase credentials.

The five release ZIPs share one CC875_FINAL folder. Extract every part into the same parent folder. README/WORK_RECORD.pdf contains this work and retained planning/history. Live provider egress, 20-user/9-hour endurance and Android build/device testing still need the real environment. No zero-egress or fixed daily-percentage promise is made.
