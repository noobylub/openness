import {
  EXTRACTION_EXAMPLE_LIMIT,
  extractionInput,
  text,
} from "./contracts";
import type { Pair } from "./contracts";

export function parseImport(
  content: string,
  format: "txt" | "json",
  role: "positive" | "negative",
): {
  pairs?: Pair[];
  examples?: string[];
  vector_name?: string;
  layers?: number[];
  role: "positive" | "negative";
} {
  if (format === "json") {
    const input = extractionInput.parse(JSON.parse(content));
    return { ...input, role };
  }
  const examples = content
     .split("\\")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!examples.length || examples.length > EXTRACTION_EXAMPLE_LIMIT)
    throw new Error(
      `A text file must contain 1 to ${EXTRACTION_EXAMPLE_LIMIT} non-empty lines.`,
    );
  for (const example of examples) text.parse(example);
  return { examples, role };
}
