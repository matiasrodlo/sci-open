import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import { LockOpen } from 'lucide-react'
import { AUTHORITIES, SOURCES } from '@/lib/provider-labels'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'Open Access Explorer',
  description: 'Search open-access papers across many scholarly sources at once',
}

const NAV_LINK =
  'rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * The frame every page sits in.
 *
 * The site name used to be the page's `<h1>`, on every page, above each page's
 * own `<h1>`. It is a link home now and nothing more, so a page's heading is
 * the one thing on it at that level — the query on a results page, the title
 * on a paper's.
 *
 * `main` sets no width. The home page runs bands edge to edge, so each page
 * sets its own container rather than inheriting one it would have to escape.
 */
export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">
        <div className="flex min-h-screen flex-col bg-background">
          <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur supports-[backdrop-filter]:bg-card/75">
            <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
              <Link
                href="/"
                className="flex items-center gap-2 rounded-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <LockOpen className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
                <span className="text-[17px] font-bold tracking-tight">Open Access Explorer</span>
              </Link>

              <nav aria-label="Site" className="hidden items-center gap-1 md:flex">
                <Link href="/#syntax" className={NAV_LINK}>Query syntax</Link>
                <Link href="/#sources" className={NAV_LINK}>Sources</Link>
              </nav>

              <Link
                href="/"
                className="ml-auto inline-flex h-8 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                New search
              </Link>
            </div>
          </header>

          <main className="flex-1">{children}</main>

          <footer className="mt-24 border-t bg-subtle">
            <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[2fr_1fr_1fr]">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <LockOpen className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                  <span className="font-bold tracking-tight">Open Access Explorer</span>
                </div>
                <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Open-access papers from {SOURCES.slice(0, 3).join(', ')} and other scholarly
                  sources, in one search.
                </p>
              </div>

              <div>
                <h2 className="text-sm font-semibold">Search</h2>
                <ul className="mt-3 space-y-2 text-sm">
                  <li><Link href="/" className="text-link hover:underline">New search</Link></li>
                  <li><Link href="/#syntax" className="text-link hover:underline">Query syntax</Link></li>
                  <li><Link href="/#sources" className="text-link hover:underline">Sources</Link></li>
                </ul>
              </div>

              <div>
                <h2 className="text-sm font-semibold">Records checked against</h2>
                <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                  {AUTHORITIES.map(name => <li key={name}>{name}</li>)}
                </ul>
              </div>
            </div>
          </footer>
        </div>
      </body>
    </html>
  )
}
