/**
 * Surface range selection for an earlier, session-only compaction threshold.
 *
 * This is the dsh translation of `pi-autocompact`'s `planCompaction`: instead of
 * planning over Pi's projected boundary context, it selects an inclusive
 * positional range on the dsh session surface, keeping the priced recent tail
 * verbatim and never splitting one step's assistant tool-call from its result.
 *
 * @module @indexyz/dsh-autocompact/compaction
 */
import { toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
/**
 * Whether the measured request pressure already crossed the effective absolute
 * threshold. Unknown or absent usage is never above it.
 */
export function needsCompaction(measurement, limit) {
    const tokens = measurement.totalTokens;
    return typeof tokens === "number" && tokens > limit;
}
/** The `system/message` occupying surface node 0, or `undefined` for other heads. */
export function systemHead(session, headSeq) {
    const head = session.eventAt(headSeq);
    return head?.type === "system/message" ? head : undefined;
}
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
export function selectCompactableRange(session, measurement, retainTokens) {
    const pricedNodes = measurement.nodes;
    if (pricedNodes.length === 0)
        return undefined;
    const surfaceNodes = session.surface.nodes;
    if (surfaceNodes.length !== pricedNodes.length ||
        surfaceNodes.some((seq, index) => seq !== pricedNodes[index]?.seq)) {
        throw new Error("autocompact: token-meter surface does not match the current session surface");
    }
    const firstIdx = systemHead(session, surfaceNodes[0]) === undefined ? 0 : 1;
    let accumulated = 0;
    let keepFromIdx = pricedNodes.length;
    for (let index = pricedNodes.length - 1; index >= 0; index -= 1) {
        accumulated += pricedNodes[index].tokens;
        keepFromIdx = index;
        if (accumulated >= retainTokens)
            break;
    }
    if (keepFromIdx <= firstIdx)
        return undefined;
    while (keepFromIdx > firstIdx) {
        if (toolPairingBalancedBefore(session, surfaceNodes[keepFromIdx]))
            break;
        keepFromIdx -= 1;
    }
    if (keepFromIdx <= firstIdx)
        return undefined;
    return {
        start: surfaceNodes[firstIdx],
        end: surfaceNodes[keepFromIdx - 1],
    };
}
//# sourceMappingURL=compaction.js.map