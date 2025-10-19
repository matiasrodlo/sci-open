import { SearchAdapter, OARecord } from '@open-access-explorer/shared';
export declare class AlgoliaAdapter implements SearchAdapter {
    private client;
    private index;
    private indexName;
    constructor(config: {
        appId: string;
        apiKey: string;
    });
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
//# sourceMappingURL=algolia.d.ts.map