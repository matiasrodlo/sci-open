'use client';

import { useState } from 'react';
import { ExternalLink, FileCheck, FileText, FlaskConical } from 'lucide-react';
import type { Paper, PaperStage } from '@open-access-explorer/shared';
import { accessRoute, copyLabel, copyNote, foundIn, notableStage } from '@/lib/access';
import { openExternal } from '@/lib/external-link';
import { cachePaper } from '@/lib/paper-cache';
import Link from 'next/link';
import { Byline } from '@/components/Byline';

interface ResultCardProps {
  record: Paper;
}

/** Sources named on a card before the rest are counted instead. */
const SOURCES_SHOWN = 3;

/** Authors named on a card before the rest are "et al.". */
const AUTHORS_SHOWN = 3;

/**
 * The glyph in the margin, which OpenAlex uses for a work's type. The type a
 * record here carries reliably is its version, so that is what it shows — a
 * flask for a preprint, a ticked page for an accepted manuscript, a plain one
 * for everything else.
 */
const STAGE_ICONS: Record<PaperStage, typeof FileText> = {
  preprint: FlaskConical,
  accepted: FileCheck,
  published: FileText,
  unknown: FileText
};

export function ResultCard({ record }: ResultCardProps) {
  const [doiCopied, setDoiCopied] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const route = accessRoute(record.oaStatus);
  const stage = notableStage(record.stage);
  const sources = foundIn(record);
  const copy = record.fullText;

  // Cache paper data for detail page
  const handlePaperClick = () => {
    cachePaper(record);
  };

  const handleCopyDOI = async () => {
    if (record.doi) {
      try {
        await navigator.clipboard.writeText(record.doi);
        setDoiCopied(true);
        setTimeout(() => setDoiCopied(false), 2000);
      } catch (error) {
        console.error('Failed to copy DOI:', error);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = record.doi;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setDoiCopied(true);
        setTimeout(() => setDoiCopied(false), 2000);
      }
    }
  };

  /**
   * Opens the copy the record names.
   *
   * This used to ask `/api/paper/:id` for the record again when the URL would
   * not open. It cannot fail to: `openExternal` refuses only what `httpUrl`
   * rejects, and a copy is built by `fullTextAt`, which keeps nothing else.
   * The error stays for a record that reached here some other way.
   */
  const handleOpenCopy = () => {
    setDownloadError(openExternal(copy?.url) ? null : 'This copy’s link could not be opened');
  };

  const StageIcon = STAGE_ICONS[record.stage] ?? FileText;

  return (
    <article className="flex gap-3 border-b py-5 last:border-b-0">
      <StageIcon className="mt-[3px] h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        {/* How it is open and which version it is, where the type sits on an
            OpenAlex list. Uppercased by CSS, so the words are still the
            words: "Gold OA", "Preprint". */}
        {(route || stage) && (
          <div className="mb-1 flex flex-wrap items-center gap-x-1.5 text-[11px] font-medium uppercase leading-4 tracking-wider text-muted-foreground">
            {route && (
              <span className="text-green-700 dark:text-green-400" title={route.note}>
                {route.label}
              </span>
            )}
            {route && stage && <span aria-hidden="true">·</span>}
            {stage && <span>{stage}</span>}
          </div>
        )}

        <div className="flex items-start justify-between gap-4">
          <h3 className="min-w-0 text-base leading-snug">
            <Link
              href={`/paper/${encodeURIComponent(record.id)}`}
              onClick={handlePaperClick}
              className="text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              {record.title}
            </Link>
          </h3>

          {/* The copy, as the outlined badge OpenAlex gives a PDF. */}
          {copy && (
            <button
              type="button"
              onClick={handleOpenCopy}
              className="shrink-0 rounded-md border border-foreground/80 px-2 py-0.5 text-[13px] font-semibold leading-5 transition-colors hover:bg-foreground hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Open the ${copy.kind === 'pdf' ? 'PDF' : 'full text'} of ${record.title} in a new tab`}
              title={copyNote(copy)}
            >
              {copyLabel(copy)}
            </button>
          )}
        </div>

        <p className="mt-1 text-sm leading-relaxed text-foreground/80 empty:hidden">
          <Byline year={record.year} authors={record.authors ?? []} venue={record.venue} shown={AUTHORS_SHOWN} />
        </p>

        {record.abstract && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {record.abstract}
          </p>
        )}

        {/* What the record carries beyond its byline — how often it is
            cited and who returned it — and then the two things a reader takes
            away from a list: the publisher's page and the DOI. Only those two
            are the group of actions; the facts beside them are not. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {record.citationCount !== undefined && record.citationCount > 0 && (
            <span>Cited by {record.citationCount.toLocaleString()}</span>
          )}
          {sources.length > 0 && (
            <span title={sources.join(', ')}>
              Found in {sources.slice(0, SOURCES_SHOWN).join(', ')}
              {sources.length > SOURCES_SHOWN && ` +${sources.length - SOURCES_SHOWN}`}
            </span>
          )}
          {(record.landingPage || record.doi) && (
            <span className="inline-flex items-center gap-x-4" role="group" aria-label={`Actions for ${record.title}`}>
              {record.landingPage && (
                <button
                  type="button"
                  onClick={() => openExternal(record.landingPage)}
                  className="inline-flex items-center gap-1 rounded-sm font-medium text-foreground/80 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Open the publisher page for ${record.title} in a new tab`}
                >
                  Source
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </button>
              )}
              {record.doi && (
                <button
                  type="button"
                  onClick={handleCopyDOI}
                  className="rounded-sm font-mono font-medium text-foreground/80 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Copy the DOI of ${record.title}`}
                  title={doiCopied ? 'DOI copied to clipboard!' : `Copy ${record.doi}`}
                >
                  <span aria-live="polite">{doiCopied ? 'Copied!' : 'DOI'}</span>
                </button>
              )}
            </span>
          )}
        </div>

        {record.topics && record.topics.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {record.topics.slice(0, 4).map((topic, index) => (
              <span key={index} className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {topic}
              </span>
            ))}
            {record.topics.length > 4 && (
              <span className="px-1 py-0.5 text-xs text-muted-foreground">
                +{record.topics.length - 4}
              </span>
            )}
          </div>
        )}

        {downloadError && (
          <p className="mt-2 text-xs text-destructive" role="alert">{downloadError}</p>
        )}
      </div>
    </article>
  );
}
