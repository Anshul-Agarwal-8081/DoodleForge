import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { applyPatch, assertGraphInvariants, createEmptyGraph, diffGraphsToPatch, GraphSchema, type Graph, type Patch } from "@doodleforge/ir";
import fixtureGraph from "../../../fixtures/board1.ir.json" with { type: "json" };
import type { LayoutOverrides, Point } from "@doodleforge/layout";

export type HistoryStep = { forward: Patch; inverse: Patch };

export type BoardState = {
  graph: Graph;
  patchLog: Patch[];
  undoStack: HistoryStep[];
  redoStack: HistoryStep[];
  layoutOverrides: LayoutOverrides;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  selectedFindingId: string | null;
  error: string | null;
  selectTarget(nodeId: string | null, edgeId?: string | null, findingId?: string | null): void;
  setPositionOverride(nodeId: string, point: Point): void;
  applyUserPatch(ops: Patch["ops"], reason: string): void;
  loadPresentationGraph(graph: Graph, reason: string): void;
  applyIncomingPatch(patch: Patch): void;
  clearForSketchJob(): void;
  undo(): void;
  redo(): void;
  clearError(): void;
};

const initialGraph = GraphSchema.parse(fixtureGraph);
assertGraphInvariants(initialGraph);
const newId = (prefix: string) => `${prefix}:${crypto.randomUUID()}`;

export const useBoardStore = create<BoardState>()(
  immer((set, get) => ({
    graph: initialGraph,
    patchLog: [],
    undoStack: [],
    redoStack: [],
    layoutOverrides: {},
    selectedNodeId: "story-signin",
    selectedEdgeId: null,
    selectedFindingId: null,
    error: null,
    selectTarget(nodeId, edgeId = null, findingId = null) {
      set((state) => {
        state.selectedNodeId = nodeId;
        state.selectedEdgeId = edgeId;
        state.selectedFindingId = findingId;
      });
    },
    setPositionOverride(nodeId, point) {
      set((state) => {
        state.layoutOverrides[nodeId] = point;
      });
    },
    applyUserPatch(ops, reason) {
      const current = get();
      const patch: Patch = {
        id: newId("manual"),
        base_version: current.graph.version,
        origin: "user",
        via: "manual",
        reason,
        ops,
      };
      try {
        const result = applyPatch(current.graph, patch);
        set((state) => {
          state.graph = result.graph;
          state.patchLog.push(result.patch);
          state.undoStack.push({ forward: result.patch, inverse: result.inverse });
          state.redoStack = [];
          state.error = null;
        });
      } catch (error) {
        set((state) => {
          state.error = error instanceof Error ? error.message : String(error);
        });
      }
    },
    loadPresentationGraph(graph, reason) {
      const current = get();
      const target = GraphSchema.parse({ ...graph, version: current.graph.version });
      const patch = diffGraphsToPatch(current.graph, target, {
        id: newId("presentation-demo"),
        origin: "user",
        via: "manual",
        reason,
      });
      try {
        const result = applyPatch(current.graph, patch);
        set((state) => {
          state.graph = result.graph;
          state.patchLog.push(result.patch);
          state.undoStack.push({ forward: result.patch, inverse: result.inverse });
          state.redoStack = [];
          state.layoutOverrides = {};
          state.selectedNodeId = result.graph.nodes[0]?.id ?? null;
          state.selectedEdgeId = null;
          state.selectedFindingId = null;
          state.error = null;
        });
      } catch (error) {
        set((state) => { state.error = error instanceof Error ? error.message : String(error); });
      }
    },
    applyIncomingPatch(patch) {
      const current = get();
      try {
        const result = applyPatch(current.graph, { ...patch, base_version: current.graph.version });
        set((state) => {
          state.graph = result.graph;
          state.patchLog.push(result.patch);
          state.undoStack.push({ forward: result.patch, inverse: result.inverse });
          state.redoStack = [];
          state.error = null;
        });
      } catch (error) {
        set((state) => {
          state.error = error instanceof Error ? error.message : String(error);
        });
      }
    },
    clearForSketchJob() {
      const current = get();
      const emptyGraph = createEmptyGraph(current.graph.diagram_id, "unknown");
      const patch = diffGraphsToPatch(current.graph, emptyGraph, {
        id: newId("sketch-import"),
        origin: "user",
        via: "manual",
        reason: "Start a new sketch import",
      });
      try {
        const result = applyPatch(current.graph, patch);
        set((state) => {
          state.graph = result.graph;
          state.patchLog.push(result.patch);
          state.undoStack.push({ forward: result.patch, inverse: result.inverse });
          state.redoStack = [];
          state.error = null;
          state.selectedNodeId = null;
          state.selectedEdgeId = null;
          state.selectedFindingId = null;
        });
      } catch (error) {
        set((state) => {
          state.error = error instanceof Error ? error.message : String(error);
        });
      }
    },
    undo() {
      const current = get();
      const step = current.undoStack.at(-1);
      if (!step) return;
      const patch = { ...step.inverse, id: newId("undo"), base_version: current.graph.version };
      try {
        const result = applyPatch(current.graph, patch);
        set((state) => {
          state.graph = result.graph;
          state.patchLog.push(result.patch);
          state.undoStack.pop();
          state.redoStack.push(step);
          state.error = null;
        });
      } catch (error) {
        set((state) => {
          state.error = error instanceof Error ? error.message : String(error);
        });
      }
    },
    redo() {
      const current = get();
      const step = current.redoStack.at(-1);
      if (!step) return;
      const patch = { ...step.forward, id: newId("redo"), base_version: current.graph.version };
      try {
        const result = applyPatch(current.graph, patch);
        set((state) => {
          state.graph = result.graph;
          state.patchLog.push(result.patch);
          state.redoStack.pop();
          state.undoStack.push({ forward: result.patch, inverse: result.inverse });
          state.error = null;
        });
      } catch (error) {
        set((state) => {
          state.error = error instanceof Error ? error.message : String(error);
        });
      }
    },
    clearError() {
      set((state) => {
        state.error = null;
      });
    },
  })),
);

