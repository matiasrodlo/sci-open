"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBestPdf = resolveBestPdf;
const axios_1 = __importDefault(require("axios"));
async function resolveBestPdf(record) {
    const candidates = [
        record.bestPdfUrl,
        candidateFromArxiv(record),
        candidateFromEuropePMC(record),
        candidateFromCORE(record),
        candidateFromNCBI(record),
        record.landingPage
    ].filter(Boolean);
    for (const url of candidates) {
        if (await looksLikePdf(url)) {
            return url;
        }
    }
    return null;
}
async function looksLikePdf(url) {
    try {
        const response = await axios_1.default.head(url, {
            timeout: 3000,
            maxRedirects: 5,
            validateStatus: (status) => status < 400
        });
        const contentType = response.headers['content-type'] || '';
        return response.status === 200 && contentType.startsWith('application/pdf');
    }
    catch (error) {
        return false;
    }
}
function candidateFromArxiv(record) {
    if (record.source === 'arxiv' && record.sourceId) {
        return `https://arxiv.org/pdf/${record.sourceId}.pdf`;
    }
    return null;
}
function candidateFromEuropePMC(record) {
    if (record.source === 'europepmc' && record.sourceId) {
        return `https://europepmc.org/articles/${record.sourceId}/pdf`;
    }
    return null;
}
function candidateFromCORE(record) {
    if (record.source === 'core' && record.sourceId) {
        return `https://core.ac.uk/download/pdf/${record.sourceId}.pdf`;
    }
    return null;
}
function candidateFromNCBI(record) {
    if (record.source === 'ncbi' && record.sourceId) {
        // Try PMC PDF if available
        return `https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${record.sourceId}/pdf/`;
    }
    return null;
}
//# sourceMappingURL=pdf.js.map