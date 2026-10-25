import * as z from "zod";
import type { Graph } from "@doodleforge/ir";
import { PrioritySchema, PrioritySourceSchema, type UserStoryRecord } from "./schema.js";

export const NoteKindSchema = z.enum(["story", "persona", "acceptance_criterion", "epic"]);
export const NoteColorMappingSchema = z.record(z.string(), NoteKindSchema);
export const DEFAULT_NOTE_COLOR_MAPPING: Record<string, z.infer<typeof NoteKindSchema>> = {
  yellow: "story",
  blue: "persona",
  green: "acceptance_criterion",
  pink: "epic",
};

export const BoardCueSchema = z.object({
  marker: z.number().int().positive(),
  box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  shapeGuess: z.string(),
  text: z.string(),
  color: z.string().optional(),
  mark: z.enum(["star", "red_dot"]).optional(),
  quadrant: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).optional(),
}).strict();
export type BoardCue = z.infer<typeof BoardCueSchema>;

export function classifyBoardCues(input: BoardCue[], colorMapping = DEFAULT_NOTE_COLOR_MAPPING) {
  const mapping = NoteColorMappingSchema.parse(colorMapping);
  return input.map((rawCue) => {
    const cue = BoardCueSchema.parse(rawCue);
    const shape = cue.shapeGuess.toLowerCase();
    const area = Math.max(0, cue.box[2] - cue.box[0]) * Math.max(0, cue.box[3] - cue.box[1]);
    const inferred = shape.includes("arrow") ? "edge"
      : mapping[cue.color?.toLowerCase() ?? ""]
        ?? (shape.includes("sticky") || shape.includes("note") ? "story" : undefined)
        ?? (shape.includes("header") || area >= 180_000 ? "epic" : "text");
    const priority = derivePriority(cue);
    return {
      marker: cue.marker,
      text: cue.text,
      kind: inferred,
      ...(inferred === "edge" ? { relation: "depends_on" as const } : {}),
      ...(priority ? { priority: priority.priority, priority_source: priority.source } : {}),
    };
  });
}

export function derivePriority(cue: Pick<BoardCue, "mark" | "quadrant">): { priority: z.infer<typeof PrioritySchema>; source: z.infer<typeof PrioritySourceSchema> } | undefined {
  if (cue.mark === "star") return { priority: "Must", source: "mark" };
  if (cue.mark === "red_dot") return { priority: "Should", source: "mark" };
  const byQuadrant = {
    top_right: "Must",
    top_left: "Should",
    bottom_right: "Could",
    bottom_left: "Won't",
  } as const;
  return cue.quadrant ? { priority: byQuadrant[cue.quadrant], source: "quadrant" } : undefined;
}

export function allocateStoryIds(existing: string[], count: number): string[] {
  const used = new Set(existing.map((id) => id.match(/^US-(\d+)$/)?.[1]).filter((value): value is string => value !== undefined).map(Number));
  const result: string[] = [];
  for (let candidate = 1; result.length < count; candidate += 1) {
    if (used.has(candidate)) continue;
    result.push(`US-${String(candidate).padStart(2, "0")}`);
  }
  return result;
}

export type DuplicatePair = { first: UserStoryRecord; second: UserStoryRecord; similarity: number };

export function findNearDuplicateCandidates(stories: UserStoryRecord[], threshold = 0.72): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let left = 0; left < stories.length; left += 1) {
    for (let right = left + 1; right < stories.length; right += 1) {
      const first = stories[left]!;
      const second = stories[right]!;
      const similarity = tokenSimilarity(`${first.title} ${first.story}`, `${second.title} ${second.story}`);
      if (similarity >= threshold) pairs.push({ first, second, similarity });
    }
  }
  return pairs;
}

/** Confirm likely duplicates with a caller-supplied model yes/no pass before dropping either record. */
export async function deduplicateStories(
  stories: UserStoryRecord[],
  confirmDuplicate: (pair: DuplicatePair) => Promise<boolean>,
): Promise<UserStoryRecord[]> {
  const removed = new Set<string>();
  for (const pair of findNearDuplicateCandidates(stories)) {
    if (!removed.has(pair.second.id) && await confirmDuplicate(pair)) removed.add(pair.second.id);
  }
  return stories.filter((story) => !removed.has(story.id));
}

export function topologicalStoryOrder(graph: Graph): string[] {
  const stories = graph.nodes.filter((node) => node.type === "story");
  const storyIds = new Set(stories.map((story) => story.id));
  const dependencies = new Map(stories.map((story) => [story.id, new Set<string>()]));
  const dependents = new Map(stories.map((story) => [story.id, new Set<string>()]));
  for (const edge of graph.edges.filter((item) => item.relation === "depends_on" && storyIds.has(item.from.node) && storyIds.has(item.to.node))) {
    dependencies.get(edge.from.node)!.add(edge.to.node);
    dependents.get(edge.to.node)!.add(edge.from.node);
  }
  const ready = stories.filter((story) => dependencies.get(story.id)!.size === 0).map((story) => story.id);
  const result: string[] = [];
  while (ready.length) {
    const current = ready.shift()!;
    result.push(current);
    for (const next of dependents.get(current) ?? []) {
      dependencies.get(next)!.delete(current);
      if (dependencies.get(next)!.size === 0) ready.push(next);
    }
  }
  if (result.length !== stories.length) throw new Error("Cannot topologically sort a cyclic user-story dependency graph");
  return result;
}

function tokenSimilarity(first: string, second: string) {
  const tokens = (value: string) => new Set(value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const a = tokens(first);
  const b = tokens(second);
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(1, new Set([...a, ...b]).size);
}
