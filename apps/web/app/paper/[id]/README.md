# Paper Detail Page

This is the paper detail page that displays comprehensive information about a single research paper.

## Route
`/paper/[id]` - Dynamic route that accepts a paper ID parameter

## Features

### Layout
- **Web of Science-style layout** with a clean, professional design
- **Two-column responsive layout**:
  - Main content area (2/3 width): Abstract, Citations, Related Papers
  - Sidebar (1/3 width): Actions, Metadata

### Components

1. **PaperHeader** - Displays:
   - Title (large, prominent)
   - Source and OA Status badges
   - DOI (if available)
   - Authors list
   - Venue and publication year
   - Topics/keywords
   - Link to source

2. **PaperAbstract** - Shows:
   - Full abstract text
   - "Show More/Less" for long abstracts (>500 chars)
   - Fallback message if no abstract available

3. **PaperMetadata** - Displays:
   - Source
   - Source ID
   - DOI (clickable link)
   - Publication year
   - Language
   - OA Status
   - Created/Updated dates

4. **PaperActions** - Provides:
   - Download PDF button
   - View Source button
   - Citation generator with copy functionality
   - Save for later (placeholder)
   - Share functionality

5. **PaperCitations** - Shows:
   - Citation count
   - Link to view citations on external services
   - Visual metrics display

6. **RelatedPapers** - Displays:
   - Up to 4 related papers based on topics
   - Clickable cards linking to other paper detail pages
   - Loading state while fetching

## API Integration

The page fetches paper details from:
- `GET /api/paper/:id` - Returns full OARecord for the paper

The API intelligently routes requests to the appropriate source connector based on the paper ID format.

## Navigation

Users can reach this page by:
1. Clicking the paper title in search results
2. Clicking the "View Details" button in result cards
3. Clicking related paper links from other paper detail pages

## Caching

- Server-side: API responses cached for 10 minutes
- Client-side: Next.js ISR with force-dynamic rendering for fresh data

