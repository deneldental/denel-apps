import type { Metadata } from 'next'
import { Montserrat, Playfair_Display } from 'next/font/google'
import './globals.css'
import { Analytics } from '@vercel/analytics/next'
import Script from 'next/script'

// Denel brand fonts — Montserrat for body/UI, Playfair Display for headings.
// next/font self-hosts both at build time (no runtime Google Fonts CDN request).
const montserrat = Montserrat({
  variable: '--font-montserrat',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
})

const playfair = Playfair_Display({
  variable: '--font-playfair',
  subsets: ['latin'],
  weight: ['400', '700'],
})

export const metadata: Metadata = {
  metadataBase: new URL('https://deneldental.com'),
  title: 'Denel Dental Clinic — Your Trusted Dental Care',
  description:
    'Professional dental services for you and your family. Quality care with a gentle touch.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${montserrat.variable} ${playfair.variable} antialiased`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[9999] focus:top-4 focus:left-4 focus:rounded-md focus:px-4 focus:py-2 focus:bg-white focus:text-black focus:ring-2 focus:ring-black focus:outline-none"
        >
          Skip to main content
        </a>
        {process.env.NEXT_PUBLIC_METRICOOL_HASH && (
          <Script
            id="metricool-tracker"
            strategy="afterInteractive"
            dangerouslySetInnerHTML={{
              __html: `function loadScript(a){var b=document.getElementsByTagName("head")[0],c=document.createElement("script");c.type="text/javascript",c.src="https://tracker.metricool.com/resources/be.js",c.onreadystatechange=a,c.onload=a,b.appendChild(c)}loadScript(function(){beTracker.t({hash:"${process.env.NEXT_PUBLIC_METRICOOL_HASH}"})})`,
            }}
          />
        )}
        <main id="main-content">{children}</main>
        <Analytics />
      </body>
    </html>
  )
}
