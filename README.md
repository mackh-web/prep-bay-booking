# PRG Prep Bay Calendar — Standalone application

Independent React/Vite + FastAPI application based on the PRG Job Portal prep bay calendar design. **No shared booking data, tables, or accounts with the Job Portal.** Deploy against a **new dedicated Supabase project** for full isolation. Do not run the schema in the existing Job Portal project.

## Deploy

1. Create a **new Supabase project** specifically for the Prep Bay Calendar.
2. In its SQL Editor, run `calendar_accounts.sql`. This creates four isolated tables and enables RLS with no browser policies.
3. In **Authentication → Users**, create a calendar-only account and confirm its email.
4. Grant the account editor or viewer access, replacing the email:

   ```sql
   insert into public.calendar_users(user_id,role)
   select id,'editor' from auth.users where lower(email)=lower('you@example.com')
   on conflict(user_id) do update set role=excluded.role,enabled=true;
   ```

5. Push this folder to a **new GitHub repository** and import it as a **new Vercel project**. Framework: Vite; root directory: repository root; build command: `npm run build`; output directory: `dist`.
6. Add these Vercel **server-side** environment variables from the NEW Supabase project:
   - `DATABASE_URL`: PostgreSQL **Session Pooler** URI, with database password URL-encoded where needed
   - `SUPABASE_URL`: new project's URL
   - `SUPABASE_PUBLISHABLE_KEY`: new project's publishable key
7. Redeploy. Sign in using the dedicated calendar account. Editors can create jobs using **+ New job**, then allocate bays using **Book Bays**, or create standalone manual bookings. Viewers can view only.

**Never** prefix database credentials with `VITE_`. Do not put any privileged Supabase secret key in browser code.

## Local development

```bash
npm install
pip install -r requirements.txt
# Export DATABASE_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY
uvicorn api.index:app --reload --port 8000
npm run dev
```

## Notes

- API endpoints verify the Supabase access token and calendar membership on each request. Editor checks apply server-side.
- Session token is in a Secure, HttpOnly, SameSite=Lax cookie scoped to `/api`. Users sign in again on token expiry; no refresh-token flow yet.
- There is **no synchronization** with the Job Portal. Calendar jobs must be created independently.
- This app does not modify the original Job Portal or its database.
- Before wide production rollout, add CSRF protection for cookie-authenticated mutations, atomic locking for all concurrent booking writes, audit logging, and an appropriate password recovery flow. This is a deployable starter, not a security-audited production release.
