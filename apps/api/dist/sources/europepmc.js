"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EuropePMCConnector = void 0;
const axios_1 = __importDefault(require("axios"));
class EuropePMCConnector {
    constructor(baseUrl = 'https://www.ebi.ac.uk/europepmc/webservices/rest') {
        this.baseUrl = baseUrl;
    }
    async search(params) {
        const { doi, titleOrKeywords, yearFrom, yearTo } = params;
        try {
            let query = '';
            if (doi) {
                query = `DOI:"${doi}"`;
            }
            else if (titleOrKeywords) {
                query = titleOrKeywords;
            }
            else {
                return [];
            }
            const searchParams = {
                query: query,
                format: 'json',
                pageSize: 50,
                resultType: 'core',
                sortBy: 'RELEVANCE',
            };
            // Add year filter if provided
            if (yearFrom || yearTo) {
                const yearFilter = [];
                if (yearFrom)
                    yearFilter.push(`PUB_YEAR:>=${yearFrom}`);
                if (yearTo)
                    yearFilter.push(`PUB_YEAR:<=${yearTo}`);
                if (yearFilter.length > 0) {
                    searchParams.query = `${searchParams.query} AND (${yearFilter.join(' AND ')})`;
                }
            }
            const response = await axios_1.default.get(`${this.baseUrl}/search`, {
                params: searchParams,
                timeout: 5000
            });
            const results = response.data?.resultList?.result || [];
            return results.map((result) => this.normalizeResult(result));
        }
        catch (error) {
            console.error('Europe PMC search error:', error);
            return [];
        }
    }
    normalizeResult(result) {
        // Extract authors
        const authors = result.authorList?.author?.map((author) => `${author.firstName || ''} ${author.lastName || ''}`.trim()) || [];
        // Determine OA status
        let oaStatus = 'other';
        if (result.isOpenAccess === 'Y') {
            oaStatus = 'published';
        }
        // Find best PDF URL from full text URLs
        let bestPdfUrl;
        if (result.fullTextUrlList?.fullTextUrl) {
            const urls = Array.isArray(result.fullTextUrlList.fullTextUrl)
                ? result.fullTextUrlList.fullTextUrl
                : [result.fullTextUrlList.fullTextUrl];
            // Try to find PDF URL
            const pdfUrl = urls.find((url) => url.documentStyle === 'pdf' || url.url?.toLowerCase().includes('.pdf'));
            if (pdfUrl) {
                bestPdfUrl = pdfUrl.url;
            }
            else if (result.pmcid) {
                // If no direct PDF URL but we have a PMC ID, construct one
                bestPdfUrl = `https://europepmc.org/articles/${result.pmcid}?pdf=render`;
            }
        }
        else if (result.pmcid) {
            // Fallback: construct URL from PMC ID
            bestPdfUrl = `https://europepmc.org/articles/${result.pmcid}?pdf=render`;
        }
        // Extract topics from keywords
        const topics = [];
        if (result.keywordList?.keyword) {
            topics.push(...result.keywordList.keyword);
        }
        return {
            id: `europepmc:${result.id}`,
            doi: result.doi,
            title: result.title || '',
            authors,
            year: result.pubYear ? parseInt(result.pubYear) : undefined,
            venue: result.journalTitle,
            abstract: result.abstractText,
            source: 'europepmc',
            sourceId: result.id?.toString() || '',
            oaStatus,
            bestPdfUrl,
            landingPage: result.fullTextUrlList?.fullTextUrl?.find((url) => url.documentStyle === 'html')?.url,
            topics,
            language: result.language || 'en',
            createdAt: result.firstPublicationDate || new Date().toISOString(),
        };
    }
}
exports.EuropePMCConnector = EuropePMCConnector;
//# sourceMappingURL=europepmc.js.map