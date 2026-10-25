import * as z from "zod";
import { DomainPackSchema } from "@doodleforge/ir";
import { userStoryRules } from "@doodleforge/rules";
import { UserStoryPropsSchema, userStoryMarkdown } from "./schema.js";
import { userStoryFewShots } from "./examples.js";

export const userStoryPack = DomainPackSchema.parse({
  id: "userstory",
  vocabulary: {
    nodeTypes: {
      epic: { propsSchema: z.object({}).strict(), icon: "layers" },
      story: { propsSchema: UserStoryPropsSchema, icon: "sticky-note" },
      persona: { propsSchema: z.object({ name: z.string().min(1) }).strict(), icon: "user" },
      acceptance_criterion: { propsSchema: z.object({ given: z.string(), when: z.string(), then: z.string() }).strict(), icon: "check" },
    },
    relations: ["depends_on", "contains"],
    allowedPortPairs: [],
  },
  classifierHint: "A product backlog, sticky-note board, or user-story map.",
  prompts: {
    transcribe: "Read exact note text and labels from numbered regions. Never infer missing words.",
    structure: "Convert the transcription to user stories with concise titles, personas, benefits, Given/When/Then criteria, priorities, dependencies, assumptions, and material questions.",
    fewShots: userStoryFewShots,
  },
  rules: userStoryRules,
  emitters: [{ id: "markdown-backlog", emit: userStoryMarkdown }],
});
