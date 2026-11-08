"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  FileJson,
  FlaskConical,
  LoaderCircle,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { extractionInput } from "@/lib/contracts";
import type { Pair } from "@/lib/contracts";
import type { parseImport } from "@/lib/import";
import { download, invalidateVectors, request } from "@/lib/client";

type Result = Record<
  string,
  {
    model: string;
    layers: Record<
      string,
      {
        vector_id: string;
        name: string | null;
        dir: number[];
        positive_count: number;
        negative_count: number;
      }
    >;
  }
>;
type ImportResult = ReturnType<typeof parseImport>;
const emptyPair = (id: string): Pair => ({
  pair_id: id,
  positive: [],
  negative: [],
});

export function ExtractionStudio() {
  const [pairs, setPairs] = useState<Pair[]>([emptyPair("direction-1")]);
  const [selected, setSelected] = useState(0);
  const [name, setName] = useState("");
  const [layers, setLayers] = useState("10, 21");
  const [role, setRole] = useState<"positive" | "negative">("positive");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null);
  const pair = pairs[selected] || pairs[0];
  const locked = busy || importing;
  const total = pairs.reduce(
    (count, item) =>
      count +
      item.positive.filter(Boolean).length +
      item.negative.filter(Boolean).length,
    0,
  );
  useEffect(() => () => worker.current?.terminate(), []);

  function updatePair(patch: Partial<Pair>) {
    setPairs((current) =>
      current.map((item, index) =>
        index === selected ? { ...item, ...patch } : item,
      ),
    );
    setResult(null);
  }
  async function importFile(file?: File) {
    if (!file || locked) return;
    setError("");
    setNotice("");
    setResult(null);
    const format = file.name.toLowerCase().endsWith(".json")
      ? "json"
      : file.name.toLowerCase().endsWith(".txt")
        ? "txt"
        : null;
    if (!format) {
      setError("Choose a .txt or .json file.");
      return;
    }
    if (!file.size || file.size > 1024 * 1024) {
      setError("Choose a non-empty file no larger than 1 MB.");
      return;
    }
    setImporting(true);
    try {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      worker.current?.terminate();
      const parser = new Worker(
        new URL("../lib/import.worker.ts", import.meta.url),
      );
      worker.current = parser;
      parser.onmessage = (
        event: MessageEvent<{ result?: ImportResult; error?: string }>,
      ) => {
        if (event.data.error || !event.data.result)
          setError(event.data.error || "Import failed.");
        else {
          const imported = event.data.result;
          if (imported.pairs) {
            setPairs(imported.pairs);
            setSelected(0);
            if (imported.vector_name) setName(imported.vector_name);
            if (imported.layers) setLayers(imported.layers.join(", "));
          } else if (imported.examples) {
            setPairs((current) =>
              current.map((item, index) =>
                index === selected
                  ? { ...item, [imported.role]: imported.examples }
                  : item,
              ),
            );
          }
          setNotice(
            `${file.name} imported. ${imported.pairs ? imported.pairs.length + " contrast groups" : imported.examples?.length + " examples"} ready for review.`,
          );
        }
        setImporting(false);
        parser.terminate();
        worker.current = null;
      };
      parser.onerror = () => {
        setError("Could not parse this file. Check its format and try again.");
        setImporting(false);
        parser.terminate();
        worker.current = null;
      };
      parser.postMessage({ content, format, role });
    } catch {
      setError("The file must contain valid UTF-8 text.");
      setImporting(false);
    }
  }
  async function extract() {
    if (locked) return;
    setError("");
    setResult(null);
    setNotice("");
    const parsed = extractionInput.safeParse({
      pairs: pairs.map((item) => ({
        ...item,
        positive: item.positive.map((value) => value.trim()).filter(Boolean),
        negative: item.negative.map((value) => value.trim()).filter(Boolean),
      })),
      ...(name.trim() ? { vector_name: name.trim() } : {}),
      ...(layers.trim()
        ? {
            layers: layers
              .split(",")
              .map((value) => (value.trim() ? Number(value.trim()) : NaN)),
          }
        : {}),
    });
    if (!parsed.success) {
      setError(
        `Check ${parsed.error.issues[0]?.path.join(" / ") || "examples"}: ${parsed.error.issues[0]?.message || "invalid input"}`,
      );
      return;
    }
    setBusy(true);
    try {
      const response = await request<Result>("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      setResult(response);
      invalidateVectors();
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : "Extraction failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  const created = result
    ? Object.entries(result).flatMap(([group, value]) =>
        Object.entries(value.layers).map(([layer, vector]) => ({
          group,
          layer,
          ...vector,
        })),
      )
    : [];

  return (
    <main className="extraction-workspace">
      <div className="extraction-heading">
        <div>
          <span className="eyebrow">02 / EXTRACTION</span>
          <h1>
            A contrast.
            <br />
            <span className="italic-word">A new direction.</span>
          </h1>
        </div>
        <div className="extraction-symbol" aria-hidden="true">
          <span>+</span>
          <span>−</span>
          <ArrowUpRight size={50} strokeWidth={1} />
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void extract();
        }}
      >
        <div className="extraction-settings">
          <label>
            Direction name
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setResult(null);
              }}
              placeholder="e.g. A more curious voice"
              maxLength={120}
              disabled={locked}
            />
          </label>
          <label>
            Target layers
            <input
              value={layers}
              onChange={(event) => {
                setLayers(event.target.value);
                setResult(null);
              }}
              placeholder="Model defaults"
              disabled={locked}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={locked}
            onClick={() =>
              download(
                {
                  vector_name: "Curiosity",
                  layers: [10, 21],
                  pairs: [
                    {
                      pair_id: "curiosity",
                      positive: [
                        "What might we discover if we explore another approach?",
                      ],
                      negative: ["There is nothing more to consider."],
                    },
                  ],
                },
                "larasati-examples.json",
              )
            }
          >
            <FileJson size={16} />
            Example JSON
          </button>
        </div>
        <div className="contrast-toolbar">
          <div className="group-tabs" aria-label="Contrast groups">
            {pairs.map((item, index) => (
              <button
                key={index}
                type="button"
                disabled={locked}
                aria-pressed={selected === index}
                className={selected === index ? "active" : ""}
                onClick={() => setSelected(index)}
              >
                Contrast {String(index + 1).padStart(2, "0")}
              </button>
            ))}
            <button
              className="icon-button"
              type="button"
              title="Add contrast group"
              disabled={locked || pairs.length >= 16}
              onClick={() => {
                setPairs((current) => [
                  ...current,
                  emptyPair(`direction-${crypto.randomUUID().slice(0, 8)}`),
                ]);
                setSelected(pairs.length);
                setResult(null);
              }}
            >
              <Plus size={17} />
            </button>
          </div>
          <span className="eyebrow">{total} EXAMPLES</span>
        </div>
        <div className="pair-id-field">
          <label>
            Group ID
            <input
              value={pair.pair_id}
              maxLength={120}
              disabled={locked}
              onChange={(event) => updatePair({ pair_id: event.target.value })}
            />
          </label>
          {pairs.length > 1 && (
            <button
              className="icon-button"
              type="button"
              title="Remove contrast group"
              disabled={locked}
              onClick={() => {
                setPairs((current) =>
                  current.filter((_, index) => index !== selected),
                );
                setSelected(0);
                setResult(null);
              }}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
        <div className="contrast-editors">
          {(["positive", "negative"] as const).map((side) => (
            <section key={side} className={`contrast-editor ${side}`}>
              <div className="editor-heading">
                <h2>
                  <span>{side === "positive" ? "+" : "−"}</span>
                  {side === "positive" ? "Lean into" : "Move away from"}
                </h2>
                <span>
                  {pair[side]
                    .filter((value) => value.trim())
                    .length.toString()
                    .padStart(2, "0")}
                </span>
              </div>
              <textarea
                aria-label={`${side} examples`}
                placeholder={
                  side === "positive"
                    ? "What if we looked at it another way?\\There might be something unexpected to discover."
                    : "There is only one possible answer.\\Everything worth knowing is already known."
                }
                value={pair[side].join("\\")}
                onChange={(event) =>
                  updatePair({ [side]: event.target.value.split("\\") })
                }
                disabled={locked}
                rows={10}
              />
              <div className="editor-foot">
                <span>{side.toUpperCase()} EXAMPLES</span>
                  <span>SEPARATE WITH {"\\"}</span>
              </div>
            </section>
          ))}
        </div>
        <div
          className={`import-strip ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!locked) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void importFile(event.dataTransfer.files[0]);
          }}
        >
          <div className="import-label">
            <Upload size={23} strokeWidth={1.4} />
            <div>
              <strong>
                {importing ? "Reading your file..." : "Bring your own words."}
              </strong>
              <small>UTF-8 TXT / JSON · UP TO 1 MB</small>
            </div>
          </div>
          <div className="import-actions">
            <select
              aria-label="Text file destination"
              value={role}
              disabled={locked}
              onChange={(event) =>
                setRole(event.target.value as "positive" | "negative")
              }
            >
              <option value="positive">Positive examples</option>
              <option value="negative">Negative examples</option>
            </select>
            <button
              className="secondary-button"
              type="button"
              disabled={locked}
              onClick={() => fileInput.current?.click()}
            >
              <Plus size={16} />
              Choose file
            </button>
            <input
              ref={fileInput}
              className="visually-hidden"
              type="file"
              accept=".txt,.json,text/plain,application/json"
              disabled={locked}
              aria-label="Upload examples"
              onChange={(event) => {
                void importFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </div>
        {notice && (
          <p className="notice" role="status">
            <Check size={16} />
            {notice}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="extraction-submit">
          <span className="muted-text">
            {busy
              ? "Extracting vectors. The model may need time to warm up."
              : `${pairs.length} contrast ${pairs.length === 1 ? "group" : "groups"} / ${total} examples`}
          </span>
          <button
            className="primary-button"
            disabled={locked || !total}
            type="submit"
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <FlaskConical size={17} />
            )}
            {busy ? "Extracting..." : "Extract direction"}
            <span className="button-arrow">
              <ArrowUpRight size={18} />
            </span>
          </button>
        </div>
      </form>
      {result && (
        <section className="extraction-results" aria-live="polite">
          <div className="results-heading">
            <div>
              <span className="eyebrow">READY FOR A NEW PERSPECTIVE</span>
              <h2>{created.length} vectors, made yours.</h2>
            </div>
            <button
              className="icon-button"
              title="Export extraction results"
              onClick={() => download(result, "larasati-vectors.json")}
            >
              <ArrowDownToLine size={20} />
            </button>
          </div>
          {created.map((item) => (
            <div className="result-row" key={`${item.group}-${item.layer}`}>
              <span className="result-check">
                <Check size={17} />
              </span>
              <div>
                <strong>{item.name || item.group}</strong>
                <small>
                  Layer {item.layer} / {item.dir.length} dimensions /{" "}
                  {item.positive_count + item.negative_count} captured tokens
                </small>
              </div>
              <code>{item.vector_id.slice(0, 10)}</code>
            </div>
          ))}
          <Link
            className="primary-button"
            href={`/?vectors=${created.map((item) => item.vector_id).join(",")}`}
          >
            Use in conversation
            <ArrowRight size={17} />
          </Link>
        </section>
      )}
    </main>
  );
}
