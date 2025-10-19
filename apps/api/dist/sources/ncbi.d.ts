import { OARecord, SourceConnector } from '@open-access-explorer/shared';
export declare class NCBIConnector implements SourceConnector {
    private baseUrl;
    private apiKey?;
    constructor(baseUrl?: string, apiKey?: string);
    search(params: {
        doi?: string;
        titleOrKeywords?: string;
        yearFrom?: number;
        yearTo?: number;
    }): Promise<OARecord[]>;
    private normalizeArticle;
}
//# sourceMappingURL=ncbi.d.ts.map