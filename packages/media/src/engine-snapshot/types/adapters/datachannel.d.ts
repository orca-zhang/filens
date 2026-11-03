import { type BoundedMediaSource } from '../types';
export interface SharedMediaFile {
    file_id: string;
    version: string;
    [key: string]: unknown;
}
export interface MediaReceiver {
    fileInfo(file: SharedMediaFile, representation: string, signal?: AbortSignal): Promise<{
        size: number;
    }>;
    read(file: SharedMediaFile, start: number, end: number, representation: string, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
}
export interface ReceiverSourceOptions {
    /** null delegates deadlines to a receiver that already bounds and retries requests. */
    requestTimeoutMs?: number | null;
}
/** Range facade over the existing Receiver. It never sends raw chunks or controls the connection. */
export declare class ReceiverMediaSource implements BoundedMediaSource {
    private receiver;
    private file;
    readonly size: number;
    private options;
    private lifetime;
    readonly identity: string;
    private constructor();
    static open(receiver: MediaReceiver, file: SharedMediaFile, signal?: AbortSignal, options?: ReceiverSourceOptions): Promise<ReceiverMediaSource>;
    read(start: number, endExclusive: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
    close(): void;
}
