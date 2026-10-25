import * as z from "zod";
import { AssumptionSchema, BoxSchema, PatchSchema, QuestionSchema } from "@doodleforge/ir";

export const DiagramDomainSchema = z.enum(["userstory", "software", "erd", "cloud", "circuit", "workflow"]);
export const VoiceInterpretationSchema = z.object({ transcript: z.string().trim().min(1).max(20_000), domain: DiagramDomainSchema }).strict();

export const ClassifyOutputSchema = z.object({
  domain: DiagramDomainSchema,
  confidence: z.number().min(0).max(1),
  alternatives: z.array(z.string()),
}).strict();

export const TranscriptionSchema = z.object({
  tags: z.array(z.object({
    tagId: z.number().int().positive(),
    kind: z.enum(["header", "note", "arrow", "text", "icon"]),
    text: z.string(),
    shape: z.string(),
    box: BoxSchema,
    confidence: z.number().min(0).max(1),
    unreadable: z.boolean().optional(),
  }).strict()).max(120),
  arrows: z.array(z.object({
    tagId: z.number().int().positive(),
    tailTag: z.number().int().positive().nullable(),
    headTag: z.number().int().positive().nullable(),
  }).strict()).max(240),
}).strict();

export const PatchBatchSchema = z.object({
  patches: z.array(PatchSchema).max(100),
  assumptions: z.array(AssumptionSchema).max(100),
  questions: z.array(QuestionSchema).max(100),
}).strict();

export const VisionMarkerSchema = z.object({
  marker: z.number().int().positive(),
  box: BoxSchema,
  shapeGuess: z.string(),
  confidence: z.number().min(0).max(1),
}).strict();

export const JobRequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixture"), fixtureId: z.string().min(1).max(80) }).strict(),
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(20_000), domainHint: DiagramDomainSchema.optional(), via: z.enum(["text", "voice"]).optional(), mode: z.enum(["fixture", "live"]).default("live") }).strict(),
  z.object({
    kind: z.literal("image"),
    name: z.string().min(1).max(255),
    mimeType: z.enum(["image/jpeg", "image/png"]),
    data: z.string().min(1).max(22_000_000),
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
    markers: z.array(VisionMarkerSchema).max(120).default([]),
    domainHint: DiagramDomainSchema.optional(),
    mode: z.enum(["fixture", "live"]).default("live"),
  }).strict(),
]);

export const VoiceJobRequestSchema = z.object({
  kind: z.literal("voice"),
  data: z.string().min(1).max(20_000_000),
  mimeType: z.enum(["audio/wav", "audio/mpeg", "audio/mp4", "audio/ogg"]),
  durationMs: z.number().int().positive().max(30_000),
  domainHint: DiagramDomainSchema.optional(),
}).strict();

export type ClassifyOutput = z.infer<typeof ClassifyOutputSchema>;
export type Transcription = z.infer<typeof TranscriptionSchema>;
export type PatchBatch = z.infer<typeof PatchBatchSchema>;
export type VisionMarker = z.infer<typeof VisionMarkerSchema>;
export type DiagramDomain = z.infer<typeof DiagramDomainSchema>;
export type VoiceInterpretation = z.infer<typeof VoiceInterpretationSchema>;
export type VoiceJobRequest = z.infer<typeof VoiceJobRequestSchema>;
export type JobRequest = z.infer<typeof JobRequestSchema>;
