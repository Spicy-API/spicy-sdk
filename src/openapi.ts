import { readFile } from "node:fs/promises";

export async function readOpenApiContract(): Promise<string> {
  const candidates = [
    new URL("../../contracts/openapi.yaml", import.meta.url),
    new URL("../contracts/openapi.yaml", import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error("the packaged SpicyAPI OpenAPI contract could not be found");
}
