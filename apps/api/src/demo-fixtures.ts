import type { Patch } from "@doodleforge/ir";
import type { PatchBatch, Transcription } from "./contracts.js";

export type DemoSketch = {
  id: string;
  title: string;
  image: string;
  description: string;
  transcription: Transcription;
  patchBatch: PatchBatch;
};

function makeDemo(
  id: string,
  title: string,
  image: string,
  epicLabel: string,
  first: { label: string; box: [number, number, number, number] },
  second: { label: string; box: [number, number, number, number] },
  edgeLabel: string,
) : DemoSketch {
  const short = id.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const epicId = `epic-${short}`;
  const groupId = `group-${short}`;
  const firstId = `story-${short}-1`;
  const secondId = `story-${short}-2`;
  const edgeId = `edge-${short}-1`;
  const assumptionId = `assumption-${short}-story-title`;
  const p0 = `fixture-${short}-structure-1`;
  const p1 = `fixture-${short}-structure-2`;
  const p2 = `fixture-${short}-structure-3`;
  const persona = "A team member";
  const firstStory = {
    id: firstId,
    type: "story",
    label: first.label,
    props: { story: `As ${persona.toLowerCase()}, I want to ${first.label.toLowerCase()}` },
    group: groupId,
    region: { marker: 2, box: first.box },
    confidence: 0.83,
    origin: "gemma" as const,
    via: "sketch" as const,
  };
  const secondStory = {
    id: secondId,
    type: "story",
    label: second.label,
    props: {
      story: `As ${persona.toLowerCase()}, I want to ${second.label.toLowerCase()}`,
      persona,
      acceptance: [{
        given: "I am signed in",
        when: `I ${second.label.toLowerCase()}`,
        then: "I see the expected result",
      }],
    },
    group: groupId,
    region: { marker: 3, box: second.box },
    confidence: 0.8,
    origin: "gemma" as const,
    via: "sketch" as const,
  };
  const assumption = {
    id: assumptionId,
    text: `The two notes are grouped under “${epicLabel}”.`,
    status: "open" as const,
    patchId: p1,
  };
  const makePatch = (patchId: string, base_version: number, ops: Patch["ops"]): Patch => ({
    id: patchId,
    base_version,
    origin: "gemma",
    via: "sketch",
    reason: `Structure ${title} from the transcribed sketch`,
    ops,
  });
  const patches: Patch[] = [
    makePatch(p0, 1, [
      { type: "add_node", node: {
        id: epicId,
        type: "epic",
        label: epicLabel,
        props: {},
        region: { marker: 1, box: [35, 45, 175, 955] },
        confidence: 0.88,
        origin: "gemma",
        via: "sketch",
      } },
      { type: "group", group: { id: groupId, label: epicLabel, members: [] } },
    ]),
    makePatch(p1, 2, [
      { type: "add_node", node: firstStory },
      { type: "group", group: { id: groupId, label: epicLabel, members: [firstId] } },
      { type: "add_assumption", assumption },
    ]),
    makePatch(p2, 3, [
      { type: "add_node", node: secondStory },
      { type: "group", group: { id: groupId, label: epicLabel, members: [firstId, secondId] } },
      { type: "add_edge", edge: {
        id: edgeId,
        from: { node: firstId },
        to: { node: secondId },
        relation: "depends_on",
        label: edgeLabel,
        region: { box: [375, 455, 445, 545] },
        confidence: 0.7,
        origin: "gemma",
        via: "sketch",
      } },
    ]),
  ];
  return {
    id,
    title,
    image,
    description: `${epicLabel}; ${first.label}; ${second.label}; arrow label ${edgeLabel}.`,
    transcription: {
      tags: [
        { tagId: 1, kind: "header", text: epicLabel, shape: "rectangle", box: [35, 45, 175, 955], confidence: 0.9 },
        { tagId: 2, kind: "note", text: first.label, shape: "sticky_note", box: first.box, confidence: 0.84 },
        { tagId: 3, kind: "note", text: second.label, shape: "sticky_note", box: second.box, confidence: 0.82 },
        { tagId: 4, kind: "arrow", text: edgeLabel, shape: "arrow", box: [375, 455, 445, 545], confidence: 0.7 },
      ],
      arrows: [{ tagId: 4, tailTag: 2, headTag: 3 }],
    },
    patchBatch: { patches, assumptions: [assumption], questions: [] },
  };
}

export const demoSketches: DemoSketch[] = [
  makeDemo("member-board", "Member experience", "/sketches/member-board.svg", "Member experience",
    { label: "Sign in with email", box: [205, 125, 610, 455] },
    { label: "View my profile", box: [205, 545, 610, 876] }, "then"),
  makeDemo("release-board", "April release", "/sketches/release-board.svg", "April launch",
    { label: "Invite teammates", box: [205, 125, 610, 455] },
    { label: "Export the report", box: [205, 545, 610, 876] }, "after"),
  makeDemo("support-board", "Support flow", "/sketches/support-board.svg", "Customer support",
    { label: "Triage a request", box: [205, 125, 610, 455] },
    { label: "Notify the customer", box: [205, 545, 610, 876] }, "when resolved"),
  makeDemo("onboarding-board", "New member onboarding", "/sketches/onboarding-board.svg", "Member onboarding",
    { label: "Create an account", box: [205, 125, 610, 455] },
    { label: "Verify the email", box: [205, 545, 610, 876] }, "then"),
  makeDemo("checkout-board", "Checkout flow", "/sketches/checkout-board.svg", "Checkout",
    { label: "Add an item to the cart", box: [205, 125, 610, 455] },
    { label: "Complete the purchase", box: [205, 545, 610, 876] }, "after"),
  makeDemo("notifications-board", "Notification preferences", "/sketches/notifications-board.svg", "Notifications",
    { label: "Receive a reminder", box: [205, 125, 610, 455] },
    { label: "Manage reminder settings", box: [205, 545, 610, 876] }, "then"),
  makeDemo("analytics-board", "Analytics report", "/sketches/analytics-board.svg", "Analytics",
    { label: "Open the dashboard", box: [205, 125, 610, 455] },
    { label: "Download a chart", box: [205, 545, 610, 876] }, "then"),
  makeDemo("team-board", "Team access", "/sketches/team-board.svg", "Team access",
    { label: "Invite a teammate", box: [205, 125, 610, 455] },
    { label: "Assign a role", box: [205, 545, 610, 876] }, "then"),
  makeDemo("search-board", "Saved search", "/sketches/search-board.svg", "Saved search",
    { label: "Find a report", box: [205, 125, 610, 455] },
    { label: "Save the filter", box: [205, 545, 610, 876] }, "then"),
  makeDemo("workspace-board", "Shared workspace", "/sketches/workspace-board.svg", "Shared workspace",
    { label: "Create a workspace", box: [205, 125, 610, 455] },
    { label: "Share it with the team", box: [205, 545, 610, 876] }, "then"),
];

export function getDemoSketch(id: string) {
  return demoSketches.find((item) => item.id === id);
}
