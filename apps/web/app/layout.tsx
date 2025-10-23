import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Open Access Explorer',
  description: 'WoS-style UI for open-access papers with multi-source search',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-background">
          <header className="border-b">
            <div className="container mx-auto px-4 py-4">
              <Link href="/" className="block">
                <h1 className="text-2xl font-bold text-primary hover:text-primary/80 transition-colors cursor-pointer">
                  Open Access Explorer
                </h1>
              </Link>
              <p className="text-sm text-muted-foreground mt-1">
                Discover open-access research papers across multiple sources
              </p>
            </div>
          </header>
          <main className="container mx-auto px-4 py-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}