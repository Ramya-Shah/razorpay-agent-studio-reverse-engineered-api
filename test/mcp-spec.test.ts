import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UpiStatsService } from "../src/service.js";

const spec = JSON.parse(readFileSync(path.resolve("mcp", "tools.json"), "utf8")) as {
  tools: { name: string; description: string; inputSchema: { required: string[]; properties: Record<string, unknown> } }[];
};

const toCamel = (s: string) => s.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());

describe("MCP tool spec", () => {
  it("every tool maps to a service method", () => {
    for (const tool of spec.tools) {
      expect(typeof (UpiStatsService.prototype as unknown as Record<string, unknown>)[toCamel(tool.name)]).toBe("function");
    }
  });

  it("every required input is declared as a property, and every tool is described", () => {
    for (const tool of spec.tools) {
      expect(tool.description.length).toBeGreaterThan(20);
      for (const r of tool.inputSchema.required) expect(tool.inputSchema.properties).toHaveProperty(r);
    }
  });

  it("exposes exactly the documented tools", () => {
    expect(spec.tools.map((t) => t.name).sort()).toEqual(
      [
        "compare_banks",
        "get_autopay_bank_stats",
        "get_bank_stats",
        "get_uptime",
        "list_banks",
        "monthly_trend",
        "recommend_retry",
        "worst_autopay_banks_by_td",
        "worst_banks_by_td",
      ],
    );
  });
});
