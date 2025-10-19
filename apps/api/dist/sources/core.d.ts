import { OARecord, SourceConnector } from '@open-access-explorer/shared';
export declare class CoreConnector implements SourceConnector {
    private baseUrl;
    private apiKey;
    constructor(baseUrl: string | undefined, apiKey: string);
    search(params: {
        doi?: string;
        titleOrKeywords?: string;
        yearFrom?: number;
        yearTo?: number;
    }): Promise<OARecord[]>;
    private normalizeResult;
}
//# sourceMappingURL=core.d.ts.map