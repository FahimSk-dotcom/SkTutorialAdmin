This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Parent app API

The parent app uses these routes:

- `POST /api/parent/login` with `parentMobile`, `password`, and optional `deviceId`.
- `GET /api/parent/me`, `GET /api/parent/students`, and `POST /api/parent/logout` with `Authorization: Bearer <token>`.
- `GET /api/parent/attendance?studentId=SK-1001&month=2026-11` with `Authorization: Bearer <token>`. The student must be linked to the authenticated parent; the month is validated as `YYYY-MM` and dates use the Asia/Kolkata calendar.
- `GET /api/parent/fees?studentId=SK-1001&year=2026` with `Authorization: Bearer <token>`. Returns the student's `admissionDate`, paid months, due months, and unpaid eligible fee months up to the current Kolkata month. Each month includes `dueDate` and `isPaymentEligible`. `summary.pendingMonths` and `summary.totalPending` remain due-only; an upcoming unpaid fee is shown as `Pending` but is not counted in those totals.
- `GET /api/parent/fees/payments?studentId=SK-1001` with `Authorization: Bearer <token>`. Returns the student's payment history, newest first.
- `GET /api/parent/receipt/<receiptNo>` with `Authorization: Bearer <token>`. Returns an authenticated PDF receipt for a payment belonging to a linked student.

Copy `.env.example` to `.env.local` for local development and configure the existing database and admin variables. Parent auth additionally requires `JWT_PARENT_SECRET`: use a cryptographically random value of at least 32 characters, distinct from `JWT_ADMIN_SECRET`. Do not expose server environment variables to the mobile app. The parent endpoints pass through the Next.js proxy and enforce their own bearer-token/session checks; other API routes retain the admin-cookie gate.

For Vercel, configure the same server-side environment variables under Project Settings → Environment Variables. Use `APP_ENV=production`, `ALLOW_PRODUCTION_DB=true`, and matching `MONGODB_DB`/`PRODUCTION_DB_NAME` values for the approved production database. Set `NEXT_PUBLIC_APP_URL` to the canonical HTTPS deployment origin and deploy through the normal Vercel project deployment flow. Set the mobile app's API base URL to the origin only, without `/api`, for example `https://<your-project>.vercel.app`; it appends `/api/parent/...`.

For local checks, run `npm run dev` and call `http://localhost:3000/api/parent/login`, then use the returned token in the `Authorization` header for the other routes. Run `npm run typecheck`, `npm test`, and `npm run build` before deployment. Do not test against production credentials or include passwords/tokens in logs.

### Browser CORS

For Expo running in a browser, set the backend's server-side `PARENT_APP_ORIGINS` variable to the exact browser origin, such as `http://localhost:8081` for local Expo web or `https://parent.example.com` for the published web app. Separate multiple origins with commas. Include the scheme and port, with no path or trailing slash. The API allows `Authorization` and `Content-Type` headers. Native Android requests do not use browser CORS enforcement.
