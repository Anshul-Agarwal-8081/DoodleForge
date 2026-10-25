import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as z from "zod";
import { DomainPackSchema, GraphSchema, PatchSchema } from "../packages/ir/src/schema.js";

const outputDir = resolve("packages/ir/json-schema");
await mkdir(outputDir, { recursive: true });

const schemas = {
  graph: GraphSchema,
  patch: PatchSchema,
  domain_pack: DomainPackSchema,
};

for (const [name, schema] of Object.entries(schemas)) {
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: "any", cycles: "ref" });
  await writeFile(resolve(outputDir, `${name}.schema.json`), `${JSON.stringify(jsonSchema, null, 2)}\n`);
}

console.log(`Exported ${Object.keys(schemas).length} schemas to ${outputDir}`);

