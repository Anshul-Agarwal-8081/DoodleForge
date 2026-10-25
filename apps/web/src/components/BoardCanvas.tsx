import { Suspense, use, useCallback, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Connection,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeChange,
} from "@xyflow/react";
import { layoutGraph, mergeLayoutOverrides } from "@doodleforge/layout";
import type { Graph } from "@doodleforge/ir";
import { useBoardStore } from "../store.js";

type NodeData = { label: string; kind: string; confidence: number };
type CanvasNode = FlowNode<NodeData>;

// React discards useMemo caches when a component suspends during its first render.
// Keep the layout promise by immutable graph snapshot so Suspense can resolve it.
const layoutPromises = new WeakMap<Graph, ReturnType<typeof layoutGraph>>();

function getLayoutPromise(graph: Graph) {
  let promise = layoutPromises.get(graph);
  if (!promise) {
    promise = layoutGraph(graph);
    layoutPromises.set(graph, promise);
  }
  return promise;
}

function GraphCanvas() {
  const graph = useBoardStore((state) => state.graph);
  const overrides = useBoardStore((state) => state.layoutOverrides);
  const selectTarget = useBoardStore((state) => state.selectTarget);
  const setPositionOverride = useBoardStore((state) => state.setPositionOverride);
  const applyUserPatch = useBoardStore((state) => state.applyUserPatch);
  const selectedNodeId = useBoardStore((state) => state.selectedNodeId);

  const baseLayoutPromise = getLayoutPromise(graph);
  const baseLayout = use(baseLayoutPromise);
  const positions = useMemo(() => mergeLayoutOverrides(baseLayout, overrides), [baseLayout, overrides]);
  const positionById = useMemo(() => new Map(positions.map((position) => [position.id, position])), [positions]);
  const nodes = useMemo<CanvasNode[]>(
    () => graph.nodes.map((node) => {
      const position = positionById.get(node.id);
      return {
        id: node.id,
        position: { x: position?.x ?? 0, y: position?.y ?? 0 },
        data: { label: node.label, kind: node.type, confidence: node.confidence },
        selected: selectedNodeId === node.id,
        className: `forge-node forge-node--${node.type}`,
        style: { width: position?.width ?? 220, minHeight: position?.height ?? 88 },
      };
    }),
    [graph.nodes, positionById, selectedNodeId],
  );
  const edges = useMemo<FlowEdge[]>(
    () => graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.from.node,
      target: edge.to.node,
      label: edge.label ?? edge.relation,
      animated: false,
      type: "smoothstep",
      className: "forge-edge",
      labelStyle: { fill: "#6c6b65", fontWeight: 600, fontSize: 11 },
    })),
    [graph.edges],
  );

  const onNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        setPositionOverride(change.id, change.position);
      }
    }
  }, [setPositionOverride]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    applyUserPatch(
      [{
        type: "add_edge",
        edge: {
          id: crypto.randomUUID(),
          from: { node: connection.source, ...(connection.sourceHandle ? { port: connection.sourceHandle } : {}) },
          to: { node: connection.target, ...(connection.targetHandle ? { port: connection.targetHandle } : {}) },
          relation: "depends_on",
          label: "depends on",
          confidence: 1,
          origin: "user",
          via: "manual",
        },
      }],
      "Connect stories on the canvas",
    );
  }, [applyUserPatch]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onConnect={onConnect}
      onNodeClick={(_event, node) => selectTarget(node.id)}
      onEdgeClick={(_event, edge) => selectTarget(null, edge.id)}
      onPaneClick={() => selectTarget(null)}
      fitView
      fitViewOptions={{ padding: 0.28 }}
      minZoom={0.25}
      maxZoom={1.6}
      attributionPosition="bottom-left"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
      <MiniMap pannable zoomable nodeStrokeWidth={3} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function BoardCanvas() {
  return (
    <Suspense fallback={<div className="canvas-loading">Laying out the graph…</div>}>
      <GraphCanvas />
    </Suspense>
  );
}

