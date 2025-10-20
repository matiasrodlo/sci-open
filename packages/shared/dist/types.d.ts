export type OARecord = {
    id: string;
    doi?: string;
    title: string;
    authors: string[];
    year?: number;
    venue?: string;
    abstract?: string;
    source: "arxiv" | "core" | "europepmc" | "ncbi" | "openaire";
    sourceId: string;
    oaStatus?: "preprint" | "accepted" | "published" | "other";
    bestPdfUrl?: string;
    landingPage?: string;
    topics?: string[];
    language?: string;
    createdAt: string;
    updatedAt?: string;
};
export type SearchFilters = {
    source?: string[];
    yearFrom?: number;
    yearTo?: number;
    oaStatus?: string[];
    venue?: string[];
};
export type SearchParams = {
    q?: string;
    doi?: string;
    filters?: SearchFilters;
    page?: number;
    pageSize?: number;
    sort?: "relevance" | "date" | "citations";
};
export type SearchResponse = {
    hits: OARecord[];
    facets: Record<string, any>;
    page: number;
    total: number;
    pageSize: number;
};
export type PaperResponse = {
    record: OARecord;
    pdf: {
        url?: string;
        status: "ok" | "not_found" | "error";
    };
};
export interface SearchAdapter {
    ensureIndex(): Promise<void>;
    upsertMany(records: OARecord[]): Promise<void>;
    search(params: {
        q?: string;
        filters?: Record<string, string[] | number[]>;
        page?: number;
        pageSize?: number;
        sort?: "relevance" | "date" | "citations";
    }): Promise<{
        hits: OARecord[];
        total: number;
        facets: Record<string, any>;
    }>;
}
export type SourceConnector = {
    search(params: {
        doi?: string;
        titleOrKeywords?: string;
        yearFrom?: number;
        yearTo?: number;
    }): Promise<OARecord[]>;
};
//# sourceMappingURL=types.d.ts.map