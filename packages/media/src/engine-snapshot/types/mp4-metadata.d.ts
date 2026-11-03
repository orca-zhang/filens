import { type BoundedMediaSource } from './types';
/** Locate ftyp/moov using box headers; never read mdat or allocate the whole file. */
export declare function readMp4Metadata(source: BoundedMediaSource, signal?: AbortSignal): Promise<{
    boxes: {
        offset: number;
        bytes: Uint8Array<ArrayBuffer>;
    }[];
    readBytes: number;
}>;
