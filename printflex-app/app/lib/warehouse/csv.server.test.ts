import { describe, expect, it } from "vitest";
import { deriveSequences, parseBinCsv, parseBundleCsv, parseCsv } from "./csv.server";

describe("csv", () => {
  it("parses quotes, CRLF, semicolons and headers", () => {
    expect(parseCsv('a,"b, c",d\r\n1,2,"3 ""x"""\n')).toEqual([["a", "b, c", "d"], ["1", "2", '3 "x"']]);
    expect(parseCsv("sku;bin\nPF-1;A-01")).toEqual([["sku", "bin"], ["PF-1", "A-01"]]);
  });

  it("parses bin maps with optional walking sequence and reports bad lines", () => {
    const result = parseBinCsv("SKU,Bin location,Walking sequence\nPF-001,B-07,2\nPF-003,A-01,1\nPF-009,C-02\nPF-BAD\nPF-002,A-04,x\nPF-001,B-08,2");
    expect(result.rows).toEqual([
      { sku: "PF-001", bin: "B-08", sequence: 2 },
      { sku: "PF-003", bin: "A-01", sequence: 1 },
      { sku: "PF-009", bin: "C-02", sequence: null },
    ]);
    expect(result.errors).toEqual([
      'Line 5: needs a SKU and a bin, got "PF-BAD".',
      'Line 6: walking sequence must be a whole number, got "x".',
    ]);
  });

  it("derives a walking sequence from bin codes when none is given", () => {
    const rows = deriveSequences(parseBinCsv("PF-1,B-10\nPF-2,A-2\nPF-3,A-10").rows);
    expect(rows.map((r) => [r.bin, r.sequence])).toEqual([["B-10", 2], ["A-2", 0], ["A-10", 1]]);
  });

  it("parses bundle maps", () => {
    const result = parseBundleCsv("bundle,component,qty,title\nKIT-1,PF-001,1,Ginseng Cream\nKIT-1,PF-009,2\nKIT-1,KIT-1,1\nKIT-2,PF-003,0");
    expect(result.rows).toEqual([
      { bundleSku: "KIT-1", componentSku: "PF-001", quantity: 1, componentTitle: "Ginseng Cream" },
      { bundleSku: "KIT-1", componentSku: "PF-009", quantity: 2, componentTitle: null },
    ]);
    expect(result.errors).toHaveLength(2);
  });
});
