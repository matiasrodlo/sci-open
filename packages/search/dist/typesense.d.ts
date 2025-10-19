import { SearchAdapter, OARecord } from '@open-access-explorer/shared';
export declare class TypesenseAdapter implements SearchAdapter {
    private client;
    private collectionName;
    constructor(config: {
        host: string;
        port: number;
        protocol: string;
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
//# sourceMappingURL=typesense.d.ts.map