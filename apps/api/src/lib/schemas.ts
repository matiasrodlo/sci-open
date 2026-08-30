/**
 * Request schemas for the public routes.
 *
 * Fastify validates and coerces against these before a handler runs, which
 * does three things the handlers were doing badly or not at all: it rejects
 * malformed input with a 400 instead of letting it reach a provider, it
 * coerces the numeric fields that arrive as strings, and it puts a ceiling on
 * `pageSize`.
 *
 * The ceiling is the point. `pageSize` was unbounded, so one request could ask
 * for the whole result set — measured at 9.4 MB — and the response cache would
 * then store it, at a cost the caller chose and the service paid. `depth` is
 * separately capped by the orchestrator; this caps what comes back.
 */

/** Twenty is the UI's page. A hundred is generous for a scripted caller. */
export const MAX_PAGE_SIZE = 100;

/**
 * A thousand pages of twenty is far past anything the ranked set holds, and
 * bounding it keeps the arithmetic in `page * pageSize` away from silly values.
 */
export const MAX_PAGE = 1000;

const stringArray = {
  type: 'array',
  items: { type: 'string', maxLength: 200 },
  maxItems: 50
} as const;

export const searchBodySchema = {
  type: 'object',
  // Unknown top-level keys are dropped rather than rejected: a client sending
  // a field this version does not know about should not get a 400 for it.
  additionalProperties: false,
  properties: {
    q: { type: 'string', maxLength: 500 },
    doi: { type: 'string', maxLength: 200 },
    page: { type: 'integer', minimum: 1, maximum: MAX_PAGE, default: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: MAX_PAGE_SIZE, default: 20 },
    sort: {
      type: 'string',
      enum: [
        'relevance', 'date', 'date_asc', 'citations', 'citations_asc',
        'author', 'author_desc', 'venue', 'venue_desc', 'title', 'title_desc'
      ],
      default: 'relevance'
    },
    filters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        source: stringArray,
        yearFrom: { type: 'integer', minimum: 1000, maximum: 9999 },
        yearTo: { type: 'integer', minimum: 1000, maximum: 9999 },
        oaStatus: stringArray,
        venue: stringArray,
        publisher: stringArray,
        topics: stringArray,
        publicationType: stringArray,
        openAccessOnly: { type: 'boolean' },
        // Declared because the results page sends it and the pipeline reads
        // it, even though `SearchFilters` does not name it. Left out, the
        // schema would silently drop the year facet's filter.
        year: stringArray
      }
    }
  }
} as const;

export const paperParamsSchema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 500 }
  }
} as const;

export const downloadPdfBodySchema = {
  type: 'object',
  required: ['pdfUrl'],
  additionalProperties: false,
  properties: {
    paperId: { type: 'string', maxLength: 500 },
    // The URL is re-validated by `assertPublicHttpUrl`, which resolves the host
    // and refuses private addresses. This only keeps the obviously wrong out.
    pdfUrl: { type: 'string', minLength: 8, maxLength: 2000, pattern: '^https?://' }
  }
} as const;
