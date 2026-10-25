import { describe, expect, it } from "vitest";
import { Script } from "node:vm";
import { checkExportConflicts, emitOpenApi, emitRunnableSoftwareApp, generatedStubs, mockResponse, softwareUiFromGraph, validateOpenApi, type SoftwareSpec } from "./index.js";

const spec: SoftwareSpec = { name: "member-api", operations: [{ id: "get-member", method: "get", path: "/members/{id}", summary: "Get member", response: { type: "object", example: { id: "m1" } } }] };
describe("software pack", () => {
  it("emits and validates an OpenAPI contract", () => { const api = emitOpenApi(spec); expect(validateOpenApi(api)).toEqual({ ok: true, errors: [] }); });
  it("returns deterministic mock responses and 404s", () => { expect(mockResponse(spec, "get", "/members/{id}")).toEqual({ status: 200, body: { id: "m1" } }); expect(mockResponse(spec, "get", "/missing")).toMatchObject({ status: 404 }); });
  it("refuses duplicate methods on paths", () => { expect(() => emitOpenApi({ ...spec, operations: [...spec.operations, { ...spec.operations[0]!, id: "other" }] })).toThrow(/Duplicate/); });
  it("generates marked stubs and detects handwritten conflicts", () => { const files = generatedStubs(spec); const path = Object.keys(files)[0]!; expect(checkExportConflicts(files, { [path]: "hand written" })).toEqual([path]); expect(checkExportConflicts(files, { [path]: files[path]! })).toEqual([]); });
  it("emits a sandbox-ready calculator app with safe arithmetic and runnable source files", () => {
    const app = emitRunnableSoftwareApp(softwareUiFromGraph({ diagram_id: "demo", nodes: [], edges: [] }));
    expect(app.files["src/App.jsx"]).toContain("setOperator");
    expect(app.files["src/App.jsx"]).not.toContain("eval(");
    expect(app.previewHtml).toContain("DoodleForge");
    const script = app.previewHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Script(script!)).not.toThrow();
    expect(Object.keys(app.files)).toContain("src/main.jsx");
  });
  it("converts a screen hierarchy to a strict calculator UI spec", () => {
    const ui = softwareUiFromGraph({ diagram_id: "wireframe", nodes: [
      { id: "screen", type: "screen", label: "Calculator", props: {}, confidence: 1, origin: "user", via: "manual" },
      { id: "display", type: "ui_component", label: "Display", props: { component: "display" }, confidence: 1, origin: "user", via: "manual" },
      { id: "plus", type: "ui_component", label: "+", props: { component: "button", action: "operator" }, confidence: 1, origin: "user", via: "manual" },
    ], edges: [{ id: "contains", from: { node: "screen" }, to: { node: "display" }, relation: "contains", confidence: 1, origin: "user", via: "manual" }] });
    expect(ui).toMatchObject({ appName: "Calculator", components: [{ id: "display", component: "display" }, { id: "plus", action: "operator" }] });
  });
});
