import { parseImport } from "./import";

self.onmessage = (
  event: MessageEvent<{
    content: string;
    format: "txt" | "json";
    role: "positive" | "negative";
  }>,
) => {
  try {
    self.postMessage({
      result: parseImport(
        event.data.content,
        event.data.format,
        event.data.role,
      ),
    });
  } catch {
    self.postMessage({
      error:
        "Invalid import. Use UTF-8 text with one example per line, or JSON containing valid pairs with positive and negative arrays.",
    });
  }
};
