import { GraphSchema, applyPatch, createEmptyGraph } from "@doodleforge/ir";
import type { Graph, Patch } from "@doodleforge/ir";

function example(id: string, input: string, title: string, persona: string, given: string, when: string, then: string) {
  const patch: Patch = {
    id: `example-${id}`,
    base_version: 0,
    origin: "rule",
    via: "text",
    reason: "Create a validated user-story few-shot example",
    ops: [{ type: "add_node", node: {
      id: `story-${id}`,
      type: "story",
      label: title,
      props: {
        story_id: "US-01",
        story: `As a ${persona.toLowerCase()}, I want to ${title.toLowerCase()} so that I can complete my work`,
        persona,
        benefit: "Complete my work",
        acceptance: [{ given, when, then }],
        priority: "Should",
        priority_source: "default",
      },
      confidence: 1,
      origin: "rule",
      via: "text",
    } }],
  };
  const graph = GraphSchema.parse(applyPatch(createEmptyGraph(`fewshot-${id}`, "userstory"), patch).graph) as Graph;
  return { input, ir: graph };
}

export const userStoryFewShots = [
  example(
    "report-export",
    "Sticky note: Export the monthly report. Header: Reporting. The note says ‘As an analyst, I want a CSV so that I can share results’.",
    "Export the monthly report",
    "Analyst",
    "I am viewing a monthly report",
    "I select Export CSV",
    "A CSV file downloads with the report data",
  ),
  example(
    "team-invite",
    "Sticky note: Invite a teammate. Persona: workspace owner. Acceptance: Given I manage the workspace, when I enter an email and send an invite, then that person receives an invitation.",
    "Invite a teammate",
    "Workspace owner",
    "I manage the workspace",
    "I enter an email and send an invite",
    "That person receives an invitation",
  ),
];
