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

## Google Sheets configuration for Appointment submissions

Set these environment variables (e.g., in a local `.env.local`):

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_KEY=
GOOGLE_SHEETS_SPREADSHEET_ID=
# Optional (defaults to Sheet1)
GOOGLE_SHEETS_WORKSHEET_TITLE=
```

Notes:
- Use a Google Cloud service account with the Google Sheets API enabled.
- Share the target spreadsheet with the service account email as an editor.
- The private key must preserve newlines; if stored as a single line, escape newlines as `\n`.

The booking page is available at `/appointments`. Submissions are appended to the configured spreadsheet.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Cloudflare

