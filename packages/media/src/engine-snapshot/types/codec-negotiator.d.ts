import type { CodecCandidate, MediaPath } from './types';
export declare function measuredSoftware(candidate: CodecCandidate): boolean;
export declare class CodecNegotiator {
    select(candidates: readonly CodecCandidate[], path: MediaPath): CodecCandidate | undefined;
}
