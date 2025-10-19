"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArxivConnector = void 0;
const axios_1 = __importDefault(require("axios"));
const xml2js_1 = require("xml2js");
class ArxivConnector {
    constructor(baseUrl = 'https://export.arxiv.org/api/query') {
        this.baseUrl = baseUrl;
    }
    async search(params) {
        const { doi, titleOrKeywords, yearFrom, yearTo } = params;
        try {
            let query = '';
            if (doi) {
                // For DOI, we can't search arXiv directly by DOI, so return empty
                return [];
            }
            if (titleOrKeywords) {
                query = `all:${titleOrKeywords}`;
            }
            // Add year filter if provided
            if (yearFrom || yearTo) {
                const yearQuery = [];
                if (yearFrom)
                    yearQuery.push(`submittedDate:[${yearFrom}01010000 TO *]`);
                if (yearTo)
                    yearQuery.push(`submittedDate:[* TO ${yearTo}12312359]`);
                if (yearQuery.length > 0) {
                    query = query ? `${query} AND (${yearQuery.join(' AND ')})` : yearQuery.join(' AND ');
                }
            }
            if (!query) {
                return [];
            }
            const response = await axios_1.default.get(this.baseUrl, {
                params: {
                    search_query: query,
                    start: 0,
                    max_results: 50,
                    sortBy: 'relevance',
                    sortOrder: 'descending'
                },
                timeout: 5000
            });
            return new Promise((resolve, reject) => {
                (0, xml2js_1.parseString)(response.data, (err, result) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    try {
                        const entries = result?.feed?.entry || [];
                        const records = entries.map((entry) => this.normalizeEntry(entry));
                        resolve(records);
                    }
                    catch (error) {
                        reject(error);
                    }
                });
            });
        }
        catch (error) {
            console.error('arXiv search error:', error);
            return [];
        }
    }
    normalizeEntry(entry) {
        const id = entry.id[0];
        const arxivId = id.split('/').pop()?.replace('v', '');
        // Extract authors
        const authors = entry.author?.map((author) => author.name[0]) || [];
        // Extract PDF URL
        const links = entry.link || [];
        const pdfLink = links.find((link) => link.$.type === 'application/pdf');
        const pdfUrl = pdfLink?.$.href;
        // Extract published date
        const published = entry.published?.[0];
        const year = published ? new Date(published).getFullYear() : undefined;
        return {
            id: `arxiv:${arxivId}`,
            title: entry.title[0].replace(/\s+/g, ' ').trim(),
            authors,
            year,
            abstract: entry.summary?.[0]?.replace(/\s+/g, ' ').trim(),
            source: 'arxiv',
            sourceId: arxivId || '',
            oaStatus: 'preprint',
            bestPdfUrl: pdfUrl,
            landingPage: id,
            topics: entry.category?.map((cat) => cat.$.term) || [],
            language: 'en',
            createdAt: published || new Date().toISOString(),
        };
    }
}
exports.ArxivConnector = ArxivConnector;
//# sourceMappingURL=arxiv.js.map