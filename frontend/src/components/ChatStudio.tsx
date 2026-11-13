"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  Copy,
  History,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { CHAT_MESSAGE_LIMIT, CHAT_OUTPUT_LIMIT, chatInput } from "@/lib/contracts";
import type { Conversation, Message, Selection, Vector } from "@/lib/contracts";
import { download, request, vectors } from "@/lib/client";
import {
  loadHistory,
  removeConversation,
  saveConversation,
} from "@/lib/history";

const prompts = [
  "Describe a city that doesn't exist.",
  "Explain a complex idea simply.",
  "Write the opening of a short story.",
];
export function ChatStudio() {
  const [available, setAvailable] = useState<Vector[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [loading, setLoading] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [loadingSeconds, setLoadingSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [notice, setNotice] = useState("");
  const [showIntro, setShowIntro] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [copied, setCopied] = useState("");
  const [maxTokens, setMaxTokens] = useState(128);
  const [deleteVector, setDeleteVector] = useState<Vector | null>(null);
  const [deleting, setDeleting] = useState(false);
  const conversationId = useRef("");
  const threadEnd = useRef<HTMLDivElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const introDialog = useRef<HTMLDialogElement>(null);
  const active = selections.filter((item) => item.enabled);
  const conflicts =
    new Set(active.map((item) => item.layer)).size !== active.length;
  const invalid = conflicts
    ? "Each active vector needs a different target layer."
    : active.length > 16
      ? "Use at most 16 active vectors."
      : "";
  const filtered = available.filter((item) =>
    `${item.name || ""} ${item.layer_id} ${item.model}`
      .toLowerCase()
      .includes(deferredSearch.toLowerCase()),
  );

  async function refresh(force = false) {
    setLoadingSeconds(0);
    setLoading(true);
    setCatalogError("");
    try {
      const catalog = await vectors(force);
      setAvailable(catalog);
      setCatalogLoaded(true);
      if (!force) {
        const ids =
          new URLSearchParams(location.search).get("vectors")?.split(",") || [];
        if (ids.length) {
          const selected = catalog.filter((vector) =>
            ids.includes(vector.vector_id),
          );
          const used = new Set<number>();
          const entries = selected.slice(0, 16).map((vector) => {
            const layer = vector.layer_id ?? 10;
            const enabled = !used.has(layer);
            used.add(layer);
            return {
              vector_id: vector.vector_id,
              name: vector.name || "Untitled vector",
              layer,
              coefficient: 1,
              enabled,
            };
          });
          setSelections(entries);
          if (entries.some((item) => !item.enabled))
            setNotice(
              "Vectors sharing a layer were added disabled. Choose one per layer.",
            );
          window.history.replaceState(null, "", "/");
        }
      }
    } catch (issue) {
      setCatalogError(
        issue instanceof Error ? issue.message : "Could not load vectors.",
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (!loading) return;
    const started = performance.now();
    const timer = setInterval(() => {
      setLoadingSeconds(Math.floor((performance.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [loading]);
  useEffect(() => {
    try {
      if (
        window.localStorage.getItem("larasati-activation-steering-intro") !==
        "dismissed"
      )
        setShowIntro(true);
    } catch {
      setNotice(
        "This browser could not load your saved introduction preference.",
      );
      setShowIntro(true);
    }
  }, []);
  useEffect(() => {
    const dialog = introDialog.current;
    if (showIntro && dialog && !dialog.open) dialog.showModal();
    else if (!showIntro && dialog?.open) dialog.close();
  }, [showIntro]);
  useEffect(() => {
    void loadHistory()
      .then(setHistory)
      .catch(() =>
        setNotice(
          "Local history is unavailable. You can still chat and export this conversation.",
        ),
      );
  }, []);

  function dismissIntro() {
    setShowIntro(false);
    try {
      window.localStorage.setItem(
        "larasati-activation-steering-intro",
        "dismissed",
      );
    } catch {
      setNotice("This browser could not save your introduction preference.");
    }
  }

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: "instant", block: "end" });
  }, [messages, busy]);
  useEffect(() => {
    if (deleteVector) deleteDialog.current?.showModal();
    else deleteDialog.current?.close();
  }, [deleteVector]);
  useEffect(() => {
    if (!drawer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [drawer]);

  function updateSelection(id: string, patch: Partial<Selection>) {
    setSelections((current) =>
      current.map((item) =>
        item.vector_id === id ? { ...item, ...patch } : item,
      ),
    );
  }
  function toggle(vector: Vector) {
    setSelections((current) =>
      current.some((item) => item.vector_id === vector.vector_id)
        ? current.filter((item) => item.vector_id !== vector.vector_id)
        : [
            ...current,
            {
              vector_id: vector.vector_id,
              name: vector.name || `Vector ${vector.vector_id.slice(0, 6)}`,
              layer: vector.layer_id ?? 10,
              coefficient: 1,
              enabled: true,
            },
          ],
    );
  }
  async function send(retry = false) {
    if (busy) return;
    const next: Message[] = retry
      ? messages
      : [
          ...messages,
          { id: crypto.randomUUID(), role: "user", content: draft.trim() },
        ];
    const parsed = chatInput.safeParse({
      messages: next.map(({ role, content }) => ({ role, content })),
      vectors: active.map(({ vector_id, coefficient, layer }) => ({
        vector_id,
        coefficient,
        layer,
      })),
      
      max_tokens: maxTokens,
    });
    if (!parsed.success) {
      setError(
        parsed.error.issues[0]?.message || "Check your prompt and vectors.",
      );
      return;
    }
    setBusy(true);
    setError("");
    setMessages(next);
    if (!retry) setDraft("");
    const snapshot = active.map((item) => ({ ...item }));
    try {
      const reply = await request<{ content: string; model: string }>(
        "/api/chat",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const completed: Message[] = [
        ...next,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: reply.content,
          model: reply.model,
          vectors: snapshot,
        },
      ];
      setMessages(completed);
      if (!conversationId.current) conversationId.current = crypto.randomUUID();
      const conversation: Conversation = {
        id: conversationId.current,
        title: next[0].content.slice(0, 70),
        updated: Date.now(),
        messages: completed,
        selections: selections.map((item) => ({ ...item })),
      };
      try {
        await saveConversation(conversation);
        setHistory((current) => [
          conversation,
          ...current.filter((item) => item.id !== conversation.id),
        ]);
      } catch {
        setNotice(
          "Conversation could not be saved locally. Export it to keep a copy.",
        );
      }
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : "Generation failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  function newConversation() {
    if (busy) return;
    setMessages([]);
    setDraft("");
    setError("");
    conversationId.current = "";
    setShowHistory(false);
  }
  async function confirmDelete() {
    if (!deleteVector || deleting) return;
    setDeleting(true);
    try {
      await request(`/api/vectors/${deleteVector.vector_id}`, {
        method: "DELETE",
      });
      setSelections((current) =>
        current.filter((item) => item.vector_id !== deleteVector.vector_id),
      );
      setDeleteVector(null);
      await refresh(true);
    } catch (issue) {
      setCatalogError(
        issue instanceof Error ? issue.message : "Deletion failed.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <main className="chat-layout">
      {drawer && (
        <button
          className="drawer-scrim"
          aria-label="Close vector controls"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside
        className={`vector-sidebar ${drawer ? "is-open" : ""}`}
        aria-label="Vector controls"
      >
        <div className="section-heading">
          <span className="eyebrow">YOUR PALETTE</span>
          <button
            className="icon-button mobile-only"
            title="Close vector controls"
            onClick={() => setDrawer(false)}
          >
            <X size={18} />
          </button>
        </div>
        <div className="library-title">
          <h2>
            Vector collection
            <span className="pink-dot" />
          </h2>
          {catalogLoaded && (
            <button
              className="icon-button"
              title="Refresh vectors"
              disabled={loading}
              onClick={() => refresh(true)}
            >
              <RefreshCw size={16} className={loading ? "spin" : ""} />
            </button>
          )}
        </div>
        {catalogLoaded && (
          <label className="search-field">
            <Search size={16} />
            <input
              placeholder="Find a direction..."
              aria-label="Search vectors"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        )}
        {catalogError && (
          <p className="error compact" role="alert">
            {catalogError}
          </p>
        )}
        <div className="vector-list" aria-busy={loading}>
          {!catalogLoaded && !loading && (
            <div className="empty-collection">
              <Layers3 size={28} strokeWidth={1.2} />
              <p>Load your vector collection when you're ready.</p>
              <small>Chat is available without loading vectors.</small>
              <button
                className="primary-button load-vectors-button"
                onClick={() => refresh()}
              >
                {catalogError ? "Retry loading vectors" : "Load vectors"}
              </button>
            </div>
          )}
          {loading && (
            <div className="catalog-loading">
              <span className="skeleton" />
              <span className="skeleton" />
              <span className="skeleton" />
              <small>Loading your collection...</small>
              <small
                role="timer"
                aria-label="Collection loading elapsed time"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {String(Math.floor(loadingSeconds / 60)).padStart(2, "0")}:
                {String(loadingSeconds % 60).padStart(2, "0")}
              </small>
            </div>
          )}
          {!loading &&
            filtered.map((vector) => (
              <div
                className={`vector-row ${selections.some((item) => item.vector_id === vector.vector_id) ? "selected" : ""}`}
                key={vector.vector_id}
              >
                <label>
                  <input
                    type="checkbox"
                    checked={selections.some(
                      (item) => item.vector_id === vector.vector_id,
                    )}
                    disabled={busy}
                    onChange={() => toggle(vector)}
                  />
                  <span>
                    <strong>
                      {vector.name || `Vector ${vector.vector_id.slice(0, 6)}`}
                    </strong>
                    <small>
                      Layer {vector.layer_id ?? "default"} /{" "}
                      {vector.hidden_size} dimensions
                    </small>
                  </span>
                </label>
                <button
                  className="icon-button"
                  title={`Delete ${vector.name || "vector"}`}
                  disabled={busy}
                  onClick={() => setDeleteVector(vector)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          {catalogLoaded && !loading && !filtered.length && (
            <div className="empty-collection">
              <Layers3 size={28} strokeWidth={1.2} />
              <p>{search ? "No matching vectors." : "A fresh collection."}</p>
              <small>
                {search
                  ? "Try a different name."
                  : "Your extracted vectors will appear here."}
              </small>
            </div>
          )}
        </div>
        <Link className="create-link" href="/extract">
          <Plus size={16} />
          Create a vector
          <ArrowUpRight size={16} />
        </Link>
        <div className="mix-heading">
          <span className="eyebrow">THE MIX</span>
          <span>{active.length.toString().padStart(2, "0")} / 16</span>
        </div>
        <div className="mix-list">
          {selections.map((selection) => (
            <section
              className={`mix-item ${selection.enabled ? "" : "muted"}`}
              key={selection.vector_id}
            >
              <div className="mix-title">
                <label>
                  <input
                    type="checkbox"
                    checked={selection.enabled}
                    disabled={busy}
                    onChange={(event) =>
                      updateSelection(selection.vector_id, {
                        enabled: event.target.checked,
                      })
                    }
                  />
                  {selection.name}
                </label>
                <button
                  className="icon-button"
                  title={`Remove ${selection.name}`}
                  disabled={busy}
                  onClick={() =>
                    setSelections((current) =>
                      current.filter(
                        (item) => item.vector_id !== selection.vector_id,
                      ),
                    )
                  }
                >
                  <X size={14} />
                </button>
              </div>
              <div className="strength-control">
                <input
                  type="range"
                  min={-5}
                  max={5}
                  step={0.1}
                  aria-label={`${selection.name} strength`}
                  value={selection.coefficient}
                  disabled={busy || !selection.enabled}
                  onChange={(event) =>
                    updateSelection(selection.vector_id, {
                      coefficient: Number(event.target.value),
                    })
                  }
                />
                <input
                  type="number"
                  min={-100}
                  max={100}
                  step={0.1}
                  aria-label={`${selection.name} coefficient`}
                  value={selection.coefficient}
                  disabled={busy || !selection.enabled}
                  onChange={(event) =>
                    updateSelection(selection.vector_id, {
                      coefficient: event.target.valueAsNumber,
                    })
                  }
                />
                <button
                  className="icon-button"
                  title={`Reset ${selection.name} strength`}
                  disabled={busy}
                  onClick={() =>
                    updateSelection(selection.vector_id, { coefficient: 1 })
                  }
                >
                  <RotateCcw size={12} />
                </button>
              </div>
              <details>
                <summary>
                  Layer {selection.layer}
                  <ChevronDown size={12} />
                </summary>
                <label className="layer-control">
                  Target layer
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={selection.layer}
                    disabled={busy}
                    onChange={(event) =>
                      updateSelection(selection.vector_id, {
                        layer: event.target.valueAsNumber,
                      })
                    }
                  />
                </label>
              </details>
            </section>
          ))}
          {!selections.length && (
            <p className="muted-text">Nothing in the mix. Yet.</p>
          )}
        </div>
        {invalid && (
          <p className="error compact" role="alert">
            {invalid}
          </p>
        )}
        <div className="sidebar-foot">
          <span className="status-dot" />
          <span>{available[0]?.model || "Awaiting your first vector"}</span>
        </div>
      </aside>
      <section className="chat-workspace" aria-label="Conversation">
        <div className="workspace-toolbar">
          <span className="eyebrow">01 / CONVERSATION</span>
          <div className="toolbar-actions">
            <button
              className="icon-button mobile-only"
              title="Vector controls"
              onClick={() => setDrawer(true)}
            >
              <SlidersHorizontal size={18} />
            </button>
            <button
              className="icon-button"
              title="Conversation history"
              aria-expanded={showHistory}
              onClick={() => setShowHistory(!showHistory)}
            >
              <History size={18} />
            </button>
            <button
              className="icon-button"
              title="Export conversation"
              disabled={!messages.length}
              onClick={() =>
                download({ messages, selections }, "larasati-conversation.json")
              }
            >
              <ArrowDownToLine size={18} />
            </button>
            <button
              className="icon-button"
              title="New conversation"
              disabled={busy}
              onClick={newConversation}
            >
              <Plus size={21} />
            </button>
          </div>
        </div>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button
              className="icon-button"
              title="Dismiss notice"
              onClick={() => setNotice("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {showHistory && (
          <section className="history-panel">
            <div className="section-heading">
              <h2>Recent conversations</h2>
              <button
                className="icon-button"
                title="Close history"
                onClick={() => setShowHistory(false)}
              >
                <X size={16} />
              </button>
            </div>
            {!history.length && (
              <p className="muted-text">
                Your completed conversations will appear here.
              </p>
            )}
            {history.map((item) => (
              <div className="history-row" key={item.id}>
                <button
                  disabled={busy}
                  onClick={() => {
                    setMessages(item.messages);
                    setSelections(item.selections);
                    conversationId.current = item.id;
                    setError("");
                    setShowHistory(false);
                  }}
                >
                  {item.title}
                  <small>{new Date(item.updated).toLocaleDateString()}</small>
                </button>
                <button
                  className="icon-button"
                  title="Delete conversation"
                  disabled={busy}
                  onClick={async () => {
                    try {
                      await removeConversation(item.id);
                      setHistory((current) =>
                        current.filter((entry) => entry.id !== item.id),
                      );
                    } catch {
                      setNotice("Could not delete the saved conversation.");
                    }
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </section>
        )}
        <div className="thread" aria-busy={busy}>
          {!messages.length ? (
            <div className="welcome">
              <div className="welcome-toolbar">
                <div className="welcome-topline">
                  <span className="little-star" aria-hidden="true">
                    ✳
                  </span>
                  <span>A LITTLE SHIFT. A DIFFERENT POSSIBILITY.</span>
                </div>
                <button
                  className="intro-reopen"
                  onClick={() => setShowIntro(true)}
                >
                  About activation steering
                  <ArrowUpRight size={14} />
                </button>
              </div>
              <h1>
                Same model.
                <br />
                Different <span className="italic-word">perspective.</span>
              </h1>
              <p className="welcome-intro">
                Activation steering guides a model’s responses by adjusting
                its internal activations as it generates text—no retraining
                required. Choose a vector, tune its strength, and try a prompt.
              </p>
              <div className="prompt-suggestions">
                {prompts.map((prompt, index) => (
                  <button key={prompt} onClick={() => setDraft(prompt)}>
                    <span>0{index + 1}</span>
                    {prompt}
                    <ArrowUpRight size={17} />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages">
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <span className="message-author">
                    {message.role === "user" ? "YOU" : "LARASATI"}
                    <span />
                  </span>
                  <div className="message-content">{message.content}</div>
                  {message.role === "assistant" && (
                    <div className="message-tools">
                      <button
                        className="icon-button"
                        title={
                          copied === message.id ? "Copied" : "Copy response"
                        }
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              message.content,
                            );
                            setCopied(message.id);
                            setTimeout(() => setCopied(""), 1800);
                          } catch {
                            setNotice(
                              "Clipboard access is unavailable in this browser.",
                            );
                          }
                        }}
                      >
                        {copied === message.id ? (
                          <Check size={15} />
                        ) : (
                          <Copy size={15} />
                        )}
                      </button>
                      <details>
                        <summary>
                          {message.vectors?.length || 0} vectors
                          <ChevronDown size={12} />
                        </summary>
                        <div className="snapshot">
                          {message.vectors?.map((item) => (
                            <span key={item.vector_id}>
                              {item.name} / L{item.layer} /{" "}
                              {item.coefficient > 0 ? "+" : ""}
                              {item.coefficient}
                            </span>
                          ))}
                        </div>
                      </details>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
          {busy && (
            <div className="thinking" role="status">
              <LoaderCircle size={17} className="spin" />
              Generating a new perspective. The model may need time to warm up.
            </div>
          )}
          <div ref={threadEnd} />
        </div>
        <div className="composer-area">
          {error && (
            <div className="error" role="alert">
              {error}
              {messages.at(-1)?.role === "user" && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => send(true)}
                >
                  <RotateCcw size={14} />
                  Retry
                </button>
              )}
            </div>
          )}
          {!active.length && (
            <p className="warning" role="status">
              No steering vector is active, so this response will be unsteered.
              For stronger steering, select a vector and set its coefficient
              above 1.
            </p>
          )}
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              aria-label="Message"
              placeholder="Where shall we take this?"
              rows={2}
              maxLength={CHAT_MESSAGE_LIMIT}
              disabled={busy}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-tools">
              <button
                type="button"
                className="vector-count"
                onClick={() => setDrawer(!drawer)}
              >
                <span className="status-dot" />
                {active.length} vectors in the mix
              </button>
              <div>
                <label className="token-control">
                  <span>Output</span>
                  <select
                    aria-label="Maximum output tokens"
                    value={maxTokens}
                    disabled={busy}
                    onChange={(event) =>
                      setMaxTokens(Number(event.target.value))
                    }
                  >
                    {[128, 256, 512, 1024, 2048, CHAT_OUTPUT_LIMIT].map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="send-button"
                  title="Send message"
                  disabled={busy || !draft.trim() || !!invalid}
                >
                  <ArrowUp size={21} />
                </button>
              </div>
            </div>
          </form>
          <div className="composer-foot">
            <span>
              A direction, not a guarantee. Verify important outputs.
            </span>
            <span>PRIVATE LOCAL HISTORY</span>
          </div>
        </div>
      </section>
      <dialog
        ref={deleteDialog}
        className="confirm-dialog"
        onCancel={() => {
          if (!deleting) setDeleteVector(null);
        }}
        onClose={() => setDeleteVector(null)}
      >
        <span className="eyebrow">VECTOR COLLECTION</span>
        <h2>Let this one go?</h2>
        <p>
          Delete {deleteVector?.name || "this vector"} from shared storage?
          Saved conversations will remain.
        </p>
        <div className="dialog-actions">
          <button
            className="secondary-button"
            disabled={deleting}
            onClick={() => setDeleteVector(null)}
          >
            Keep vector
          </button>
          <button
            className="primary-button danger-button"
            disabled={deleting}
            onClick={confirmDelete}
          >
            <Trash2 size={16} />
            {deleting ? "Deleting..." : "Delete vector"}
          </button>
        </div>
      </dialog>
      <dialog
        ref={introDialog}
        className="activation-intro-dialog"
        aria-labelledby="activation-intro-title"
        onCancel={(event) => {
          event.preventDefault();
          dismissIntro();
        }}
      >
        <section className="activation-intro">
          <div className="intro-dialog-header">
            <div className="welcome-topline">
              <span className="little-star" aria-hidden="true">
                ✳
              </span>
              <span>A QUICK INTRODUCTION</span>
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label="Close introduction"
              onClick={dismissIntro}
            >
              <X size={18} />
            </button>
          </div>
          <h1 id="activation-intro-title">
            Steer a response.
            <br />
            Keep the <span className="italic-word">same model.</span>
          </h1>
          <p className="intro-lead">
            Activation steering guides a language model’s responses by
            applying a direction to its internal activations as it generates
            text. It doesn’t retrain the model or change its weights.
          </p>
          <div className="intro-steps">
            <article>
              <span className="eyebrow">01 / IN CHAT</span>
              <h2>Try a steering vector</h2>
              <p>
                Choose a vector in the controls, adjust its strength and target
                layer, then write a prompt. On smaller screens, open the
                Vector controls panel first.
              </p>
            </article>
            <article>
              <span className="eyebrow">02 / MAKE YOUR OWN</span>
              <h2>Set a new direction</h2>
              <p>
                In Extraction, add examples to lean into and examples to move
                away from. Generate a vector, then select it here to steer a
                conversation.
              </p>
              <Link
                className="intro-extraction-link"
                href="/extract"
                onClick={dismissIntro}
              >
                Explore Extraction
                <ArrowUpRight size={15} />
              </Link>
            </article>
          </div>
          <p className="intro-note">
            Steering is a nudge, not a guarantee. Outputs can vary; verify
            important information.
          </p>
          <a
            className="intro-extraction-link"
            href="https://www.anthropic.com/research/persona-vectors"
            target="_blank"
            rel="noreferrer"
          >
            Based on Anthropic’s Persona Vectors
            <ArrowUpRight size={15} />
          </a>
          <button
            className="primary-button intro-start"
            onClick={dismissIntro}
          >
            Start exploring
            <ArrowUpRight size={16} />
          </button>
        </section>
      </dialog>
    </main>
  );
}
