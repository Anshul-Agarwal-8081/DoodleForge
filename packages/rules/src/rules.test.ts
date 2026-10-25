import { describe, expect, it } from "vitest";
import { coreRules } from "./core.js";
import { runRules } from "./engine.js";
import { ruleFixtures } from "./fixtures.js";
import { userStoryRules } from "./userstory.js";

const allRules = [...coreRules, ...userStoryRules];

describe("pure rule fixtures", () => {
  it.each(allRules.map((rule) => [rule.id, rule] as const))("%s has failing and passing fixtures", (_id, rule) => {
    const fixture = ruleFixtures[rule.id];
    expect(fixture, `Missing fixtures for ${rule.id}`).toBeDefined();
    expect(runRules(fixture!.failing, [rule]).length).toBeGreaterThan(0);
    expect(runRules(fixture!.passing, [rule])).toEqual([]);
  });

  it("returns all active-pack findings as verified, deterministic diagnostics", () => {
    const fixture = ruleFixtures["userstory.no-acceptance-criteria"]!;
    const first = runRules(fixture.failing, allRules);
    const second = runRules(fixture.failing, allRules);
    expect(first).toEqual(second);
    expect(first.find((item) => item.rule === "userstory.no-acceptance-criteria")?.trust).toBe("verified");
  });
});

