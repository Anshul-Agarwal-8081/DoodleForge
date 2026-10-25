import { describe, expect, it } from "vitest";
import type { Graph } from "@doodleforge/ir";
import { cloudRules } from "./rules.js";
import { emitTerraform } from "./hcl.js";
import { verifyTerraform } from "./terraform.js";

function graph(nodes: Graph["nodes"]): Graph { return { diagram_id: "cloud-test", version: 0, domain: "cloud", nodes, edges: [], groups: [], assumptions: [], questions: [], diagnostics: [], constraints: { provider: "aws", region: "us-west-2" }, style: {} }; }
function node(id: string, type: string, label: string, props: Record<string, unknown> = {}): Graph["nodes"][number] { return { id, type, label, props, confidence: 1, origin: "user", via: "text" }; }

describe("cloud pack", () => {
  it("generates deterministic AWS Terraform with encrypted buckets and no execution/apply mode", () => {
    const output = emitTerraform(graph([node("bucket", "bucket", "Uploads Bucket")]));
    expect(output.hcl).toContain('region = "us-west-2"');
    expect(output.hcl).toContain('resource "aws_s3_bucket_server_side_encryption_configuration"');
    expect(output.mode).toBe("plan-only");
    expect(output.hcl).not.toContain("0.0.0.0/0");
  });
  it("ships a failing and passing public-bucket fixture through its rule", () => {
    expect(cloudRules[0]!.check(graph([node("public", "bucket", "Public uploads", { public: true })]))).toHaveLength(1);
    expect(cloudRules[0]!.check(graph([node("private", "bucket", "Private uploads", { public: false })]))).toEqual([]);
  });
  it("detects open ingress and disabled storage encryption", () => {
    expect(cloudRules[1]!.check(graph([node("sg", "security_group", "web", { ingress: [{ cidr: "0.0.0.0/0", port: 22 }] })]))).toHaveLength(1);
    expect(cloudRules[2]!.check(graph([node("db", "database", "primary", { encryption: false })]))).toHaveLength(1);
  });
  it("reports terraform unavailable or a real verification result without hiding errors", async () => {
    const result = await verifyTerraform(graph([node("b", "bucket", "assets")]), { binary: "doodleforge-terraform-not-installed" });
    expect(result.status).toBe("unavailable");
    expect(result.verified).toBe(false);
    expect(result.stage).toBe("fmt");
  });
  it("does not interpolate user strings as arbitrary HCL", () => {
    const output = emitTerraform(graph([node("bucket", "bucket", 'x"\nresource "aws_iam_user" "pwn" {')]));
    expect(output.hcl).not.toContain('resource "aws_iam_user"');
    expect(output.hcl).toContain('bucket = "x-resource-aws_iam_user-pwn"');
  });
});
