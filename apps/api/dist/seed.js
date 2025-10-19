"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const search_1 = require("@open-access-explorer/search");
// Sample records for seeding
const sampleRecords = [
    {
        id: 'arxiv:2301.00001',
        title: 'Large Language Models for Scientific Discovery',
        authors: ['John Doe', 'Jane Smith'],
        year: 2023,
        venue: 'arXiv',
        abstract: 'This paper explores the use of large language models for scientific discovery and research applications.',
        source: 'arxiv',
        sourceId: '2301.00001',
        oaStatus: 'preprint',
        bestPdfUrl: 'https://arxiv.org/pdf/2301.00001.pdf',
        landingPage: 'https://arxiv.org/abs/2301.00001',
        topics: ['machine learning', 'natural language processing', 'scientific discovery'],
        language: 'en',
        createdAt: '2023-01-01T00:00:00Z'
    },
    {
        id: 'core:12345',
        title: 'Open Access Publishing Trends in Computer Science',
        authors: ['Alice Johnson', 'Bob Wilson'],
        year: 2023,
        venue: 'Journal of Open Science',
        abstract: 'An analysis of open access publishing trends in computer science journals over the past decade.',
        source: 'core',
        sourceId: '12345',
        oaStatus: 'published',
        bestPdfUrl: 'https://example.com/paper12345.pdf',
        landingPage: 'https://example.com/paper/12345',
        topics: ['open access', 'publishing', 'computer science'],
        language: 'en',
        createdAt: '2023-06-15T00:00:00Z'
    },
    {
        id: 'europepmc:67890',
        title: 'Machine Learning Applications in Biomedical Research',
        authors: ['Carol Davis', 'David Brown'],
        year: 2023,
        venue: 'Nature Machine Intelligence',
        abstract: 'A comprehensive review of machine learning applications in biomedical research and clinical practice.',
        source: 'europepmc',
        sourceId: '67890',
        oaStatus: 'published',
        bestPdfUrl: 'https://example.com/biomedical-ml.pdf',
        landingPage: 'https://example.com/paper/67890',
        topics: ['machine learning', 'biomedical research', 'clinical applications'],
        language: 'en',
        createdAt: '2023-09-20T00:00:00Z'
    }
];
async function seed() {
    const searchBackend = process.env.SEARCH_BACKEND || 'typesense';
    let searchAdapter;
    switch (searchBackend) {
        case 'typesense':
            searchAdapter = new search_1.TypesenseAdapter({
                host: process.env.TYPESENSE_HOST || 'localhost',
                port: parseInt(process.env.TYPESENSE_PORT || '8108'),
                protocol: process.env.TYPESENSE_PROTOCOL || 'http',
                apiKey: process.env.TYPESENSE_API_KEY || 'xyz'
            });
            break;
        case 'meili':
            searchAdapter = new search_1.MeilisearchAdapter({
                host: process.env.MEILI_HOST || 'http://localhost:7700',
                apiKey: process.env.MEILI_MASTER_KEY || 'xyz'
            });
            break;
        case 'algolia':
            searchAdapter = new search_1.AlgoliaAdapter({
                appId: process.env.ALGOLIA_APP_ID || '',
                apiKey: process.env.ALGOLIA_API_KEY || ''
            });
            break;
        default:
            throw new Error(`Unsupported search backend: ${searchBackend}`);
    }
    try {
        console.log(`Seeding ${searchBackend} with sample records...`);
        // Ensure index exists
        await searchAdapter.ensureIndex();
        console.log('Index ensured');
        // Add sample records
        await searchAdapter.upsertMany(sampleRecords);
        console.log(`Added ${sampleRecords.length} sample records`);
        console.log('Seeding completed successfully!');
    }
    catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}
seed();
//# sourceMappingURL=seed.js.map