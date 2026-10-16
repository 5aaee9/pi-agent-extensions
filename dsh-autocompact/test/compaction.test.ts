import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SessionSeq } from "@deepseek-ai/dsh-session";

vi.mock("@deepseek-ai/dsh-compaction", () => ({
  toolPairingBalancedBefore: vi.fn<(session: unknown, seq: unknown) => boolean>(),
}));

import { toolPairingBalancedBefore } from "@deepseek-ai/dsh-compaction";
import { needsCompaction, selectCompactableRange, systemHead } from "../compaction.ts";

function session(seqs: number[], head: "system" | "message" = "message") {
  return {
    surface: { nodes: seqs as SessionSeq[] },
    eventAt: (seq: SessionSeq) =>
      seq === (seqs[0] as SessionSeq)
        ? { type: head === "system" ? "system/message" : "user/message" }
        : { type: "user/message" },
  } as unknown as Session;
}

function measurement(entries: Array<[number, number]>) {
  return {
    nodes: entries.map(([seq, tokens]) => ({ seq: seq as SessionSeq, tokens })),
  } as never;
}

beforeEach(() => {
  vi.mocked(toolPairingBalancedBefore).mockReturnValue(true);
});

describe("surface range selection", () => {
  it("retains the priced recent tail and summarizes only the prefix", () => {
    const target = session([0, 1, 2, 3]);
    const range = selectCompactableRange(
      target,
      measurement([
        [0, 10],
        [1, 10],
        [2, 100],
        [3, 100],
      ]),
      150,
    );
    // Walking back from node 3 accumulates 100, then 200 >= 150 at node 2.
    expect(range).toEqual({ start: 0, end: 1 });
  });

  it("never includes a leading system message in the range", () => {
    const target = session([0, 1, 2, 3], "system");
    const range = selectCompactableRange(
      target,
      measurement([
        [0, 10],
        [1, 10],
        [2, 100],
        [3, 100],
      ]),
      150,
    );
    expect(range).toEqual({ start: 1, end: 1 });
  });

  it("retains more history until the kept edge is a balanced tool-call boundary", () => {
    vi.mocked(toolPairingBalancedBefore).mockImplementation((_target, seq) => seq !== 3);
    const target = session([0, 1, 2, 3, 4]);
    const range = selectCompactableRange(
      target,
      measurement([
        [0, 10],
        [1, 10],
        [2, 10],
        [3, 100],
        [4, 100],
      ]),
      150,
    );
    expect(range).toEqual({ start: 0, end: 1 });
  });

  it("does not generate a no-op compaction for indivisible or small contexts", () => {
    expect(selectCompactableRange(session([0]), measurement([[0, 10]]), 100)).toBeUndefined();
    expect(
      selectCompactableRange(
        session([0, 1]),
        measurement([
          [0, 10],
          [1, 10],
        ]),
        100,
      ),
    ).toBeUndefined();
    expect(selectCompactableRange(session([]), measurement([]), 100)).toBeUndefined();
  });

  it("refuses a measurement that does not describe the current surface", () => {
    expect(() => selectCompactableRange(session([0, 1]), measurement([[0, 10]]), 5)).toThrow(
      /does not match/,
    );
    expect(() =>
      selectCompactableRange(
        session([0, 1]),
        measurement([
          [1, 10],
          [0, 10],
        ]),
        5,
      ),
    ).toThrow(/does not match/);
  });

  it("detects only present usage above the threshold", () => {
    expect(needsCompaction({ totalTokens: 300001 }, 300000)).toBe(true);
    expect(needsCompaction({ totalTokens: 300000 }, 300000)).toBe(false);
    expect(needsCompaction({ totalTokens: undefined as unknown as number }, 300000)).toBe(false);
  });

  it("reads the surface head type", () => {
    const target = session([7, 8], "system");
    expect(systemHead(target, 7 as SessionSeq)).toBeDefined();
    expect(systemHead(target, 8 as SessionSeq)).toBeUndefined();
  });
});
