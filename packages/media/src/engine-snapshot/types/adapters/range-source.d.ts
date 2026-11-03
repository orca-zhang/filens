import { type BoundedMediaSource } from '../types';
export interface RangeResponse {
    status: number;
    data: ArrayBuffer;
    headers: Record<string, unknown> | {
        get(name: string): unknown;
    };
}
export type RangeRequest = (start: number, endInclusive: number, signal: AbortSignal) => Promise<RangeResponse>;
export declare function linkAbort(...parents: (AbortSignal | undefined)[]): {
    controller: AbortController;
    dispose: () => void;
};
/** The injected Photos request must validate headers before consuming its body. */
export declare class HttpRangeSource implements BoundedMediaSource {
    readonly identity: string;
    private request;
    readonly nativeUrl?: string;
    private lifetime;
    private revision;
    private total;
    constructor(identity: string, request: RangeRequest, nativeUrl?: string);
    get size(): number;
    read(start: number, endExclusive: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
    close(): void;
}
