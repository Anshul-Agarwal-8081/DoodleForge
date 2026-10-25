import type { Graph } from "@doodleforge/ir";

export type Point = { x: number; y: number };
export type LayoutOverrides = Record<string, Point>;
export type LayoutPosition = Point & { id: string; width: number; height: number };

export type LayoutOptions = {
  direction?: "RIGHT" | "DOWN";
  nodeWidth?: number;
  nodeHeight?: number;
  layerSpacing?: number;
  nodeSpacing?: number;
};

type ElkEngine = { layout(input: Record<string, unknown>): Promise<{ children?: Array<{ id: string; x?: number; y?: number; width?: number; height?: number }> }> };
let elkPromise: Promise<ElkEngine> | undefined;

function getElk() {
  elkPromise ??= import("elkjs/lib/elk.bundled.js").then((module) => {
    const Elk = (module as unknown as { default: new () => ElkEngine }).default;
    return new Elk();
  });
  return elkPromise;
}

export function mergeLayoutOverrides(
  positions: LayoutPosition[],
  overrides: LayoutOverrides,
): LayoutPosition[] {
  return positions.map((position) => ({ ...position, ...overrides[position.id] }));
}

export async function layoutGraph(
  graph: Graph,
  overrides: LayoutOverrides = {},
  options: LayoutOptions = {},
): Promise<LayoutPosition[]> {
  const nodeWidth = options.nodeWidth ?? 220;
  const nodeHeight = options.nodeHeight ?? 88;
  const elk = await getElk();
  const layoutInput = {
    id: graph.diagram_id,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": options.direction ?? "RIGHT",
      "elk.spacing.nodeNode": String(options.nodeSpacing ?? 44),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(options.layerSpacing ?? 92),
      "elk.edgeRouting": "ORTHOGONAL",
    },
    children: graph.nodes.map((node) => ({ id: node.id, width: nodeWidth, height: nodeHeight })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.from.node],
      targets: [edge.to.node],
    })),
  };
  const laidOut = await elk.layout(layoutInput);
  const positions = (laidOut.children ?? []).map((child) => ({
      id: child.id,
      x: child.x ?? 0,
      y: child.y ?? 0,
      width: child.width ?? nodeWidth,
      height: child.height ?? nodeHeight,
    }));
  return mergeLayoutOverrides(positions, overrides);
}

