"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoreConnector = void 0;
const axios_1 = __importDefault(require("axios"));
class CoreConnector {
    constructor(baseUrl = 'https://api.core.ac.uk/v3', apiKey) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
    }
    async search(params) {
        const { doi, titleOrKeywords, yearFrom, yearTo } = params;
        try {
            let query = '';
            if (doi) {
                query = `doi:"${doi}"`;
            }
            else if (titleOrKeywords) {
                query = titleOrKeywords;
            }
            else {
                return [];
            }
            const searchParams = {
                q: query,
                limit: 50,
                offset: 0,
            };
            // Add year filter if provided
            if (yearFrom || yearTo) {
                const yearFilter = [];
                if (yearFrom)
                    yearFilter.push(`yearPublished:>=${yearFrom}`);
                if (yearTo)
                    yearFilter.push(`yearPublished:<=${yearTo}`);
                if (yearFilter.length > 0) {
                    searchParams.filters = yearFilter.join(' AND ');
                }
            }
            const response = await axios_1.default.get(`${this.baseUrl}/search/works`, {
                params: searchParams,
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                timeout: 5000
            });
            const results = response.data?.results || [];
            return results.map((result) => this.normalizeResult(result));
        }
        catch (error) {
            console.error('CORE search error:', error);
            return [];
        }
    }
    normalizeResult(result) {
        // Extract authors
        const authors = result.authors?.map((author) => author.name || `${author.firstName || ''} ${author.lastName || ''}`.trim()) || [];
        // Determine OA status
        let oaStatus = 'other';
        if (result.isOpenAccess) {
            oaStatus = 'published';
        }
        // Find best PDF URL
        let bestPdfUrl;
        if (result.downloadUrl) {
            bestPdfUrl = result.downloadUrl;
        }
        else if (result.fullTextIdentifier) {
            bestPdfUrl = result.fullTextIdentifier;
        }
        return {
            id: `core:${result.id}`,
            doi: result.doi,
            title: result.title || '',
            authors,
            year: result.yearPublished,
            venue: result.publishedVenue?.name || result.journal?.name,
            abstract: result.abstract,
            source: 'core',
            sourceId: result.id?.toString() || '',
            oaStatus,
            bestPdfUrl,
            landingPage: result.links?.find((link) => link.type === 'display')?.url,
            topics: result.topics?.map((topic) => topic.label) || [],
            language: result.language?.name || 'en',
            createdAt: result.depositedDate || new Date().toISOString(),
        };
    }
}
exports.CoreConnector = CoreConnector;
//# sourceMappingURL=core.js.map