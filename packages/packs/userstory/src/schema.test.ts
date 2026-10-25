import { describe, expect, it } from "vitest";
import { applyPatch, createEmptyGraph } from "@doodleforge/ir";
import type { Graph, Patch } from "@doodleforge/ir";
import { storyRecordFromNode, userStoryMarkdown } from "./schema.js";

function makeGraph(includeAcceptance: boolean): Graph {
  const props = {
    story: "As a member, I want to export a report so that I can share it",
    persona: "Member",
    ...(includeAcceptance ? { acceptance: [{ given: "I am signed in", when: "I export a report", then: "A CSV downloads" }] } : {}),
  };
  const patch: Patch = {
    id: "story-seed",
    base_version: 0,
    origin: "user",
    via: "manual",
    reason: "Create fixture story",
    ops: [{
      type: "add_node",
      node: { id: "story-export", type: "story", label: "Export a report", props, confidence: 1, origin: "user", via: "manual" },
    }],
  };
  return applyPatch(createEmptyGraph("test", "userstory"), patch).graph;
}

describe("user-story output contract", () => {
  it("marks a story with persona and criteria as verified", () => {
    const audit = storyRecordFromNode(makeGraph(true), "story-export");
    expect(audit?.status).toBe("verified");
    expect(audit?.record?.acceptance).toHaveLength(1);
  });

  it("keeps a story with no criteria visible as a draft", () => {
    const graph = makeGraph(false);
    const audit = storyRecordFromNode(graph, "story-export");
    expect(audit?.status).toBe("draft");
    expect(audit?.errors.join(" ")).toContain("no acceptance criteria");
    expect(userStoryMarkdown(graph)).toContain("Not provided");
  });
});
