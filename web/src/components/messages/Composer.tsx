import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Image as ImageIcon, Loader2, Mic, MicOff, X } from "lucide-react";

import {
  cancelRequest,
  getConfig,
  type Message,
  postMessage,
} from "../../api/client";
import { uploadWikiFile, wikiFileUrl } from "../../api/wiki";
import { bilingual } from "../../lib/bilingual";
import { useCommands } from "../../hooks/useCommands";
import { useOfficeMembers } from "../../hooks/useMembers";
import { useRequests } from "../../hooks/useRequests";
import {
  extractTaggedMentions,
  parseMentions,
  renderMentionTokens,
} from "../../lib/mentions";
import {
  askPrefix,
  handleSlashCommand,
  resolveLeadSlug,
  unknownSlashCommandMessage,
} from "../../lib/slashCommands";
import { useChannelSlug } from "../../routes/useCurrentRoute";
import { useAppStore } from "../../stores/app";
import { showNotice } from "../ui/Toast";
import {
  Autocomplete,
  type AutocompleteItem,
  applyAutocomplete,
} from "./Autocomplete";

/** How many sent messages to keep in per-channel history. */
const COMPOSER_HISTORY_LIMIT = 20;

/** sessionStorage key shape: `wuphf:composer-history:<channel>`.
 *  No "general" default: the only caller is ChannelComposer, whose channel is
 *  non-empty by construction, and bucketing a channel-less history under
 *  #general mixed unrelated drafts into the retired room's key. */
function historyKey(channel: string): string {
  return `wuphf:composer-history:${channel}`;
}

function readHistory(channel: string): string[] {
  try {
    const raw = sessionStorage.getItem(historyKey(channel));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
  } catch {
    return [];
  }
}

function writeHistory(channel: string, entries: string[]): void {
  try {
    sessionStorage.setItem(historyKey(channel), JSON.stringify(entries));
  } catch {
    // sessionStorage disabled / quota exceeded — silently drop history rather
    // than blowing up the send flow. The user still sees their message land.
  }
}

/**
 * Append a sent message to the per-channel history, trimming to the most
 * recent COMPOSER_HISTORY_LIMIT entries. Skips duplicates of the latest
 * entry so rapid resends do not pollute recall.
 */
function pushHistory(channel: string, message: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  const current = readHistory(channel);
  if (current.length > 0 && current[current.length - 1] === trimmed) return;
  const next = [...current, trimmed].slice(-COMPOSER_HISTORY_LIMIT);
  writeHistory(channel, next);
}

interface MessagesQueryData {
  messages?: Message[];
}

function latestMessageIdFromQueryData(
  data: MessagesQueryData | undefined,
): string | null {
  if (!data?.messages) return null;
  for (let i = data.messages.length - 1; i >= 0; i--) {
    const id = data.messages[i]?.id?.trim();
    if (id) return id;
  }
  return null;
}

function latestCachedMessageId(
  queryClient: QueryClient,
  channel: string,
): string | null {
  const entries = queryClient.getQueriesData<MessagesQueryData>({
    queryKey: ["messages", channel],
  });
  for (let i = entries.length - 1; i >= 0; i--) {
    const id = latestMessageIdFromQueryData(entries[i][1]);
    if (id) return id;
  }
  return null;
}

function emptyMessagesQueryData(
  data: MessagesQueryData | undefined,
): MessagesQueryData | undefined {
  if (!data?.messages) return data;
  return { ...data, messages: [] };
}

interface OutboundMessage {
  content: string;
  tagged: string[];
}

/**
 * History recall state. `draftStash` holds whatever the operator had typed
 * before the first Ctrl+P so we can restore it when they walk forward past
 * the end of history.
 */
interface HistoryState {
  /** -1 when live, else index into the cached history array. */
  index: number;
  /** Draft text to restore when stepping past the end. */
  draftStash: string | null;
  /** Snapshot taken at recall start; kept so mid-recall writes don't churn it. */
  entries: string[];
}

function emptyHistoryState(): HistoryState {
  return { index: -1, draftStash: null, entries: [] };
}

/**
 * Composer — the human's message box.
 *
 * The channel is resolved HERE and nowhere below, because this is the highest
 * consequence of the three places the old `channel ?? routeChannel ??
 * "general"` lived: line 259 posts a message. With no channel that post went
 * to #general, the human watched their message appear, and nothing told them
 * it had landed somewhere nobody reads.
 *
 * Resolution happens in this outer component, which calls one hook and then
 * branches, so ChannelComposer below is only ever mounted with a genuinely
 * non-empty channel — the invariant is structural, not a guard someone can
 * delete later.
 */
export function Composer({ channel }: { channel?: string } = {}) {
  // Prefer an explicit channel (the task-detail chat passes the task's channel,
  // where useChannelSlug() is null). Fall back to the channel route slug so the
  // channel surface behaves exactly as before.
  const routeChannel = useChannelSlug();
  const currentChannel = channel?.trim() || routeChannel?.trim() || "";

  if (!currentChannel) {
    return (
      <div
        className="composer composer--no-channel"
        data-testid="composer-no-channel"
      >
        <p className="composer-no-channel-note">
          No conversation to post into yet. Assign an owner and the conversation
          starts in their DM.
        </p>
      </div>
    );
  }

  return <ChannelComposer channel={currentChannel} />;
}

interface ComposerAttachment {
  id: string;
  name: string;
  path: string;
  url: string;
  previewUrl: string;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Existing function length is baselined for a focused follow-up refactor.
function ChannelComposer({ channel }: { channel: string }) {
  // Non-empty by construction — Composer above is the only caller and guards
  // it, so nothing here has to re-check.
  const currentChannel = channel;
  const setLastMessageId = useAppStore((s) => s.setLastMessageId);
  const setChannelClearMarker = useAppStore((s) => s.setChannelClearMarker);
  const pendingComposerDraft = useAppStore((s) => s.pendingComposerDraft);
  const consumePendingComposerDraft = useAppStore(
    (s) => s.consumePendingComposerDraft,
  );
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [acItems, setAcItems] = useState<AutocompleteItem[]>([]);
  const [acIdx, setAcIdx] = useState(0);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const initialTextRef = useRef<string>("");
  // Guards the cancel-then-send path so a fast double-Enter cannot
  // fire two send POSTs before sendMutation.isPending flips. Cleared
  // in finally() after the inner send mutates (or fails synchronously).
  const [isPreSendPending, setIsPreSendPending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { data: cfg } = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: 60_000,
  });
  const { data: members = [] } = useOfficeMembers();
  // If the human chooses to type into the channel instead of clicking a
  // blocking interview's button, treat that as "I'm replying in chat
  // instead." Cancel the interview so the broker unblocks, and let the
  // bot see the typed message as the new context. Channel-scoped to
  // match the broker's gate: a blocking request only parks chat in ITS
  // channel now, so typing in #general must not cancel an approval that
  // is pending in some task channel.
  const { pending: pendingRequests } = useRequests();
  const blockingPending = useMemo(
    () =>
      pendingRequests.find(
        (r) =>
          r.blocking === true && (!r.channel || r.channel === currentChannel),
      ) ?? null,
    [pendingRequests, currentChannel],
  );
  const leadSlug = useMemo(
    () => resolveLeadSlug(cfg?.team_lead_slug, members),
    [cfg?.team_lead_slug, members],
  );
  // Slugs the mirror-overlay recognises as mention chips. Memoed against
  // the member list reference so the token parse downstream doesn't
  // re-allocate on every Composer render.
  const knownSlugs = useMemo(() => members.map((m) => m.slug), [members]);
  const mentionTokens = useMemo(
    () => parseMentions(text, knownSlugs),
    [text, knownSlugs],
  );
  // Broker-backed slash-command registry. Falls back to the hardcoded
  // list if the broker is unreachable so the composer is never worse
  // than before this plumbing landed.
  const commands = useCommands();

  const historyRef = useRef<HistoryState>(emptyHistoryState());

  // Reset recall when switching channels so Ctrl+P replays *this* channel.
  useEffect(() => {
    historyRef.current = emptyHistoryState();
  }, []);

  // Consume a one-shot composer prefill (e.g. the office tour finish handoff
  // seeds an example first issue in the CEO DM). Fires when a draft targeting
  // this channel appears, whether the user navigated here or was already here.
  // consumePendingComposerDraft clears it so it never re-applies on a revisit.
  useEffect(() => {
    if (
      !pendingComposerDraft ||
      pendingComposerDraft.channel !== currentChannel
    ) {
      return;
    }
    const draft = consumePendingComposerDraft(currentChannel);
    if (draft === null) return;
    setText(draft);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
      setCaret(end);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    });
  }, [pendingComposerDraft, currentChannel, consumePendingComposerDraft]);

  const resetRecall = useCallback(() => {
    historyRef.current = emptyHistoryState();
  }, []);

  const pickAutocomplete = useCallback(
    (item: AutocompleteItem) => {
      const next = applyAutocomplete(text, caret, item);
      setText(next.text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
        setCaret(next.caret);
      });
    },
    [text, caret],
  );

  const sendMutation = useMutation({
    mutationFn: ({ content, tagged }: OutboundMessage) =>
      postMessage(content, currentChannel, undefined, tagged),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", currentChannel] });
    },
    onError: (err: unknown) => {
      const message =
        err instanceof Error ? err.message : "Failed to send message";
      // The broker blocks chat with 409 + "request pending; answer required"
      // for approval-style requests. The request UI above the composer lets
      // the user answer or dismiss/cancel it without leaving the textbox.
      if (/request pending|answer required/i.test(message)) {
        showNotice(
          "Answer or dismiss the request above to send messages.",
          "info",
        );
        return;
      }
      showNotice(message, "error");
    },
  });

  const uploadAndAttach = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      showNotice(bilingual("Only image files are supported", "仅支持上传图片格式文件"), "error");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      showNotice(bilingual("Image size must not exceed 25MB", "图片大小不能超过 25MB"), "error");
      return;
    }
    setIsUploading(true);
    const previewUrl = URL.createObjectURL(file);
    try {
      const res = await uploadWikiFile("team/uploads", file);
      const url = wikiFileUrl(res.path);
      setAttachments((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name || "image.png",
          path: res.path,
          url,
          previewUrl,
        },
      ]);
      showNotice(bilingual("Image attached", "图片已添加至输入框"), "info");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Upload failed";
      showNotice(bilingual(`Failed to upload image: ${msg}`, `图片上传失败: ${msg}`), "error");
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      let hasImage = false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf("image") !== -1) {
          const file = item.getAsFile();
          if (file) {
            hasImage = true;
            const finalFile =
              file.name && file.name !== "image.png"
                ? file
                : new File(
                    [file],
                    `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
                    { type: file.type },
                  );
            void uploadAndAttach(finalFile);
          }
        }
      }
      if (hasImage) {
        e.preventDefault();
      }
    },
    [uploadAndAttach],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          if (files[i].type.startsWith("image/")) {
            void uploadAndAttach(files[i]);
          }
        }
      }
    },
    [uploadAndAttach],
  );

  /**
   * Clear the composer, shrink the textarea, and cancel any pending recall.
   * Called after every successful send or consumed command.
   */
  const resetComposer = useCallback(() => {
    setText("");
    setAttachments([]);
    resetRecall();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [resetRecall]);

  const clearCurrentChannelMessages = useCallback(() => {
    const markerId = latestCachedMessageId(queryClient, currentChannel);
    setLastMessageId(null);
    setChannelClearMarker(currentChannel, markerId);
    queryClient.setQueriesData<MessagesQueryData>(
      { queryKey: ["messages", currentChannel] },
      emptyMessagesQueryData,
    );
    queryClient.invalidateQueries({ queryKey: ["messages", currentChannel] });
    showNotice("Messages cleared", "info");
  }, [currentChannel, queryClient, setChannelClearMarker, setLastMessageId]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (
      (!trimmed && attachments.length === 0) ||
      sendMutation.isPending ||
      isPreSendPending ||
      isUploading
    ) {
      return;
    }

    let finalContent = trimmed;
    if (attachments.length > 0) {
      const imageLines = attachments
        .map((att) => `![${att.name}](${att.url})\n[图片路径: ${att.path}]`)
        .join("\n\n");
      if (finalContent) {
        finalContent = `${finalContent}\n\n${imageLines}`;
      } else {
        finalContent = imageLines;
      }
    }

    // If a blocking interview is pending, cancel it before sending so the
    // broker doesn't 409 the message. The bot will see the cancellation
    // plus the human's free-form reply on its next turn and react to that
    // instead of the dead choice list.
    const pendingId = blockingPending?.id ?? null;
    const dismissPending = pendingId
      ? cancelRequest(pendingId)
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: ["requests"] });
            void queryClient.invalidateQueries({
              queryKey: ["requests-badge"],
            });
          })
          .catch((err: unknown) => {
            // If cancel races with another resolver the request is already
            // gone; don't block the send on it.
            console.warn("composer: failed to cancel blocking request", err);
          })
      : Promise.resolve();

    const send = () => {
      // Handle slash commands
      if (trimmed.startsWith("/")) {
        const consumed = handleSlashCommand(trimmed, {
          leadSlug,
          sendAsMessage: (rewritten) => {
            const contentToSend =
              attachments.length > 0
                ? `${rewritten}\n\n${attachments.map((att) => `![${att.name}](${att.url})\n[图片路径: ${att.path}]`).join("\n\n")}`
                : rewritten;
            sendMutation.mutate({
              content: contentToSend,
              tagged: extractTaggedMentions(rewritten, knownSlugs),
            });
          },
          clearMessages: clearCurrentChannelMessages,
          channel: currentChannel,
        });
        if (consumed) {
          pushHistory(currentChannel, trimmed);
          resetComposer();
          return;
        }
      }

      if (trimmed) {
        pushHistory(currentChannel, trimmed);
      }
      sendMutation.mutate({
        content: finalContent,
        tagged: extractTaggedMentions(finalContent, knownSlugs),
      });
      resetComposer();
    };

    if (pendingId) {
      setIsPreSendPending(true);
      void dismissPending.then(send).finally(() => setIsPreSendPending(false));
    } else {
      send();
    }
  }, [
    text,
    attachments,
    isUploading,
    sendMutation,
    leadSlug,
    currentChannel,
    resetComposer,
    knownSlugs,
    clearCurrentChannelMessages,
    blockingPending,
    queryClient,
    isPreSendPending,
  ]);


  /**
   * Walk backward through history. On first invocation, snapshot the live
   * draft so Ctrl+N can restore it. Returns true if recall succeeded.
   */
  const recallPrevious = useCallback((): boolean => {
    const state = historyRef.current;
    if (state.index === -1) {
      const entries = readHistory(currentChannel);
      if (entries.length === 0) return false;
      state.entries = entries;
      state.draftStash = text;
      state.index = entries.length;
    }
    if (state.index <= 0) return false;
    state.index -= 1;
    setText(state.entries[state.index]);
    return true;
  }, [currentChannel, text]);

  /**
   * Walk forward through history. When we run off the end, restore the
   * original draft and clear recall state.
   */
  const recallNext = useCallback((): boolean => {
    const state = historyRef.current;
    if (state.index === -1) return false;
    if (state.index < state.entries.length - 1) {
      state.index += 1;
      setText(state.entries[state.index]);
      return true;
    }
    setText(state.draftStash ?? "");
    historyRef.current = emptyHistoryState();
    return true;
  }, []);

  const moveCaretToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      const end = el.value.length;
      el.setSelectionRange(end, end);
      setCaret(end);
    });
  }, []);

  const handleKeyDown = useCallback(
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Existing cognitive complexity is baselined for a focused follow-up refactor.
    (e: React.KeyboardEvent) => {
      // Autocomplete navigation runs first
      if (acItems.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAcIdx((i) => (i + 1) % acItems.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAcIdx((i) => (i - 1 + acItems.length) % acItems.length);
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const pick = acItems[acIdx] ?? acItems[0];
          if (pick) pickAutocomplete(pick);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAcItems([]);
          return;
        }
      }

      // History recall — Ctrl+P / Ctrl+N (TUI parity: internal/tui/interaction.go:56-58)
      if (e.ctrlKey && !e.metaKey && !e.altKey) {
        if ((e.key === "p" || e.key === "P") && recallPrevious()) {
          e.preventDefault();
          moveCaretToEnd();
          return;
        }
        if ((e.key === "n" || e.key === "N") && recallNext()) {
          e.preventDefault();
          moveCaretToEnd();
          return;
        }
      }

      // Slack-style: empty-draft ArrowUp recalls the last message.
      if (
        e.key === "ArrowUp" &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        text === "" &&
        recallPrevious()
      ) {
        e.preventDefault();
        moveCaretToEnd();
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [
      handleSend,
      acItems,
      acIdx,
      pickAutocomplete,
      recallPrevious,
      recallNext,
      text,
      moveCaretToEnd,
    ],
  );

  const handleAcItems = useCallback((items: AutocompleteItem[]) => {
    setAcItems(items);
    setAcIdx((idx) => Math.min(idx, Math.max(items.length - 1, 0)));
  }, []);

  const syncCaret = useCallback(() => {
    const el = textareaRef.current;
    if (el) setCaret(el.selectionStart ?? 0);
  }, []);

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, []);

  // Keep the mirror overlay scroll-locked to the textarea. Once content
  // overflows the 120px cap, the textarea scrolls internally; the mirror
  // has no scroll constraint of its own, so without this the chips would
  // drift out of alignment with the visible text rows.
  const syncScroll = useCallback(() => {
    const src = textareaRef.current;
    const dst = mirrorRef.current;
    if (src && dst) dst.scrollTop = src.scrollTop;
  }, []);

  const toggleVoiceInput = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      showNotice(
        bilingual(
          "Your browser does not support Speech Recognition. Please use Chrome, Edge, or a Chromium-based browser.",
          "当前浏览器暂不支持语音识别，推荐使用 Chrome、Edge 等 Chromium 内核浏览器。",
        ),
      );
      return;
    }

    if (isListening) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "zh-CN";

      initialTextRef.current = text;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let interim = "";
        let finalized = "";
        for (let i = 0; i < event.results.length; i++) {
          const piece = event.results[i][0]?.transcript || "";
          if (event.results[i].isFinal) {
            finalized += piece;
          } else {
            interim += piece;
          }
        }
        const speech = (finalized + interim).trimStart();
        if (speech) {
          const prefix = initialTextRef.current;
          const connector = prefix && !/[，。？！,!?\s]$/.test(prefix) ? " " : "";
          const next = prefix ? `${prefix}${connector}${speech}` : speech;
          setText(next);
          setCaret(next.length);
          requestAnimationFrame(() => {
            handleInput();
            syncScroll();
            const el = textareaRef.current;
            if (el) {
              el.scrollTop = el.scrollHeight;
            }
          });
        }
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech recognition error:", event?.error);
        if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
          showNotice(
            bilingual(
              "Microphone access was denied. Please allow microphone permission in browser settings.",
              "麦克风权限未开启，请在浏览器地址栏允许麦克风权限后重试。",
            ),
          );
        } else if (event?.error === "network") {
          showNotice(
            bilingual(
              "Speech service network blocked: Current Chromium browser (Tabbit/Chrome) relies on Google Speech API. Please open in Edge browser (supports direct native Chinese speech) or enable proxy.",
              "语音网络受限：当前浏览器（Tabbit/Chrome内核）依赖 Google 语音服务器。建议：直接使用 Edge 浏览器打开（微软中文语音免代理直连），或开启网络代理后重试。",
            ),
          );
        } else if (event?.error !== "no-speech") {
          showNotice(bilingual(`Voice recognition: ${event?.error}`, `语音识别提示：${event?.error}`));
        }
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
        textareaRef.current?.focus();
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error("Failed to start speech recognition:", err);
      setIsListening(false);
      showNotice(
        bilingual(
          "Could not start speech recognition.",
          "未能启动语音识别，请检查麦克风设置。",
        ),
      );
    }
  }, [isListening, text, handleInput, syncScroll]);

  // Clean up recognition on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    };
  }, []);

  return (
    <div
      className="composer"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <Autocomplete
        value={text}
        caret={caret}
        selectedIdx={acIdx}
        onItems={handleAcItems}
        onPick={pickAutocomplete}
        commands={commands}
      />
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((att) => (
            <div key={att.id} className="composer-attachment-card">
              <img
                src={att.previewUrl || att.url}
                alt={att.name}
                className="composer-attachment-thumb"
              />
              <span className="composer-attachment-name" title={att.name}>
                {att.name}
              </span>
              <button
                type="button"
                className="composer-attachment-remove"
                onClick={() => {
                  setAttachments((prev) => prev.filter((a) => a.id !== att.id));
                }}
                aria-label={bilingual("Remove image", "移除图片")}
                title={bilingual("Remove image", "移除图片")}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="composer-inner">
        <div className="composer-field">
          {/* Mirror overlay: renders the same text as the textarea but with
              mention chips. The textarea sits on top with transparent text
              and a visible caret so the user still sees and edits the raw
              string — only the chips are styled. aria-hidden because the
              textarea is the interactive source of truth. */}
          <div ref={mirrorRef} className="composer-mirror" aria-hidden="true">
            {renderMentionTokens(mentionTokens)}
            {/* Trailing newline so the mirror height matches a textarea
                that ends on a blank line (otherwise the chip layout
                truncates by one row). */}
            {"\n"}
          </div>
          <textarea
            ref={textareaRef}
            className="composer-input"
            placeholder={bilingual(
              `Message #${currentChannel}`,
              `发送消息至 #${currentChannel}（支持 Ctrl+V 粘贴截图）`,
            )}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCaret(e.target.selectionStart ?? 0);
              handleInput();
              syncScroll();
              // Any manual edit cancels history recall.
              if (historyRef.current.index !== -1) {
                resetRecall();
              }
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            onScroll={syncScroll}
            onPaste={handlePaste}
            rows={1}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            const files = e.target.files;
            if (files) {
              for (let i = 0; i < files.length; i++) {
                void uploadAndAttach(files[i]);
              }
            }
            e.target.value = "";
          }}
        />
        {isListening && (
          <div className="composer-voice-indicator" aria-live="polite">
            <span className="voice-wave" />
            <span>{bilingual("Listening... Click mic to stop", "正在倾听中... 点击麦克风停止")}</span>
          </div>
        )}
        <button
          type="button"
          className={`composer-voice-btn${isListening ? " recording" : ""}`}
          onClick={toggleVoiceInput}
          aria-label={
            isListening
              ? bilingual("Stop voice input", "停止语音输入")
              : bilingual("Voice input", "语音输入（支持中英文）")
          }
          title={
            isListening
              ? bilingual("Listening... Click to stop", "正在倾听录音中... 点击停止")
              : bilingual("Voice input (Chinese / English)", "语音输入（支持中英文）")
          }
        >
          {isListening ? <MicOff size={16} /> : <Mic size={16} />}
        </button>
        <button
          type="button"
          className="composer-upload-btn"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          aria-label={bilingual("Upload image", "上传图片")}
          title={bilingual(
            "Upload image (or paste screenshot with Ctrl+V)",
            "上传图片（或直接按 Ctrl+V 粘贴截图）",
          )}
        >
          {isUploading ? (
            <Loader2 className="composer-spinner" size={16} />
          ) : (
            <ImageIcon size={16} />
          )}
        </button>
        <button
          type="button"
          className="composer-send"
          disabled={
            (!text.trim() && attachments.length === 0) ||
            sendMutation.isPending ||
            isPreSendPending ||
            isUploading
          }
          onClick={handleSend}
          aria-label={bilingual("Send message", "发送消息")}
        >
          <svg
            aria-hidden="true"
            focusable="false"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m22 2-7 20-4-9-9-4Z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
      </div>
    </div>
  );

}

// Re-export helpers for testing.
export const __test__ = {
  historyKey,
  readHistory,
  writeHistory,
  pushHistory,
  unknownSlashCommandMessage,
  handleSlashCommand,
  resolveLeadSlug,
  askPrefix,
  latestMessageIdFromQueryData,
  emptyMessagesQueryData,
  COMPOSER_HISTORY_LIMIT,
};
