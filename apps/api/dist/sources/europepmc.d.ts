import { OARecord, SourceConnector } from '@open-access-explorer/shared';
export declare class EuropePMCConnector implements SourceConnector {
    private baseUrl;
    constructor(baseUrl?: string);
    search(params: {
        doi?: string;
        titleOrKeywords?: string;
        yearFrom?: number;
        yearTo?: number;
    }): Promise<OARecord[]>;
    private normalizeResult;
}
//# sourceMappingURL=europepmc.d.ts.map