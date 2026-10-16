import type { Session, SessionSeq } from "@deepseek-ai/dsh-session";
import type { TokenMeasurement } from "@deepseek-ai/dsh-token-meter";
/** One inclusive positional span on the session surface. */
export interface CompactableRange {
    /** First surface-node seq to replace, inclusive. */
    readonly start: SessionSeq;
    /** Last surface-node seq to replace, inclusive. */
    readonly end: SessionSeq;
}
/**
 * Whether the measured request pressure already crossed the effective absolute
 * threshold. Unknown or absent usage is never above it.
 */
export declare function needsCompaction(measurement: Pick<TokenMeasurement, "totalTokens">, limit: number): boolean;
/** The `system/message` occupying surface node 0, or `undefined` for other heads. */
export declare function systemHead(session: Session, headSeq: SessionSeq): ({
    type: "system/message";
    seq: SessionSeq;
    time: number;
    data: {
        turn: number;
        step: number;
        message: import("@deepseek-ai/dsh-session").SystemMessage;
    };
    ignorable?: true;
} & {
    surfaceOp: import("@deepseek-ai/dsh-session").SurfaceOp;
} & {
    sourceEventSeqs?: SessionSeq[];
}) | undefined;
/**
 * Resolve the next range starting at the first non-system surface node while
 * retaining a priced recent tail and never splitting an assistant
 * tool-call/result pair. A `system/message` at surface node 0 is never inside
 * the range; without one the range starts at node 0.
 *
 * Returns `undefined` when the surface is too small or one indivisible
 * oversized message cannot be compacted and still shrink, which leaves the
 * decision to the backend's own overflow or manual compaction.
 *
 * @param session - session supplying authoritative current surface positions.
 * @param measurement - pressure and surface measurement from the token meter.
 * @param retainTokens - minimum recent tail budget retained verbatim.
 * @returns the inclusive positional seq range to compact, or `undefined`.
 */
export declare function selectCompactableRange(session: Session, measurement: Pick<TokenMeasurement, "nodes">, retainTokens: number): CompactableRange | undefined;
//# sourceMappingURL=compaction.d.ts.map