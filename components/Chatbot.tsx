"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { GREETING, SUGGESTIONS, answer, type KbMenuItem } from "@/lib/chatbot-kb";

type Msg = {
  id: number;
  sender: "bot" | "user";
  text: string;
  action?: { label: string; href: string };
};

/* Minimal shape of the Web Speech API bits we use — the DOM lib doesn't
   ship these types. */
type SpeechRecognitionResultLike = {
  results?: ArrayLike<ArrayLike<{ transcript?: string }>>;
  error?: string;
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((e: SpeechRecognitionResultLike) => void) | null;
  onerror: ((e: SpeechRecognitionResultLike) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

let nextId = 1;

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [speechOn, setSpeechOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [input, setInput] = useState("");
  const [micSupported, setMicSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  // Live POS catalog, so the bot quotes today's prices and never a stale one.
  const menuRef = useRef<KbMenuItem[]>([]);
  const menuLoaded = useRef(false);

  const greetedRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const speechOnRef = useRef(true);
  const listeningRef = useRef(false);
  speechOnRef.current = speechOn;
  listeningRef.current = listening;

  function stopSpeaking() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function speak(text: string) {
    if (!speechOnRef.current || listeningRef.current) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      u.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const en =
        voices.find((v) => /en[-_]?IN/i.test(v.lang)) ||
        voices.find((v) => /^en\b/i.test(v.lang));
      if (en) u.voice = en;
      window.speechSynthesis.speak(u);
    } catch {
      /* no-op */
    }
  }

  function push(m: Omit<Msg, "id">) {
    setMessages((prev) => [...prev, { ...m, id: nextId++ }]);
  }

  function respond(text: string) {
    setTyping(true);
    window.setTimeout(() => {
      setTyping(false);
      const a = answer(text, menuRef.current);
      push({ sender: "bot", text: a.text, action: a.action });
      speak(a.text);
    }, 420 + Math.random() * 280);
  }

  function send(raw: string) {
    const text = raw.trim();
    if (!text) return;
    stopSpeaking(); // never talk over the user
    push({ sender: "user", text });
    setInput("");
    respond(text);
  }

  /* ---- set up speech recognition + TTS once ---- */
  useEffect(() => {
    if (typeof window === "undefined") return;
    setTtsSupported("speechSynthesis" in window);

    const w = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;

    setMicSupported(true);
    const rec = new Ctor();
    rec.lang = "en-IN";
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onstart = () => setListening(true);
    rec.onend = () => setListening(false);
    rec.onresult = (e: SpeechRecognitionResultLike) => {
      const transcript = e.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) send(transcript);
    };
    rec.onerror = (e: SpeechRecognitionResultLike) => {
      setListening(false);
      console.warn("[chatbot] speech recognition error:", e?.error);
      if (e?.error === "not-allowed" || e?.error === "service-not-allowed") {
        push({
          sender: "bot",
          text: "I need microphone access to hear you. Tap the mic icon in your browser's address bar to allow it, then try again.",
        });
      } else if (e?.error === "no-speech") {
        push({
          sender: "bot",
          text: "I didn't catch that — tap the mic and speak again, or type your question.",
        });
      } else if (e?.error === "network") {
        push({
          sender: "bot",
          text: "I couldn't reach the speech service — check your internet connection and try again, or type your question.",
        });
      } else if (e?.error === "audio-capture") {
        push({
          sender: "bot",
          text: "I can't find a working microphone. Check it's connected and not in use by another app, then try again.",
        });
      } else if (e?.error !== "aborted") {
        push({
          sender: "bot",
          text: "Something went wrong with voice input — try again, or type your question.",
        });
      }
    };
    recRef.current = rec;

    return () => {
      try {
        rec.abort();
      } catch {
        /* no-op */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing, listening]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function loadMenu() {
    if (menuLoaded.current) return;
    menuLoaded.current = true;
    try {
      const res = await fetch("/api/menu-brief");
      const data = await res.json();
      if (Array.isArray(data?.items)) menuRef.current = data.items as KbMenuItem[];
    } catch {
      menuLoaded.current = false; // let a later open retry
    }
  }

  function openPanel() {
    void loadMenu();
    setOpen(true);
    if (!greetedRef.current) {
      greetedRef.current = true;
      push({ sender: "bot", text: GREETING });
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.getVoices(); // prime lazy voice list
      }
      speak(GREETING);
    }
    window.setTimeout(() => inputRef.current?.focus(), 150);
  }

  function closePanel() {
    setOpen(false);
    stopSpeaking();
    try {
      recRef.current?.abort();
    } catch {
      /* no-op */
    }
  }

  function toggleMic() {
    const rec = recRef.current;
    if (!rec) return;
    if (listeningRef.current) {
      rec.stop();
      return;
    }
    stopSpeaking(); // stop the assistant so it doesn't talk over you
    try {
      rec.start();
      setListening(true);
    } catch {
      /* already running — ignore */
    }
  }

  return (
    <div className={`nl-chat${open ? " open" : ""}`}>
      <button
        type="button"
        className="nl-fab"
        aria-expanded={open}
        aria-controls="nlPanel"
        aria-label="Chat with the Next Level assistant"
        onClick={openPanel}
        style={{ position: "relative" }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        <span className="nl-dot" aria-hidden="true" />
      </button>

      <div
        id="nlPanel"
        className="nl-panel"
        role="dialog"
        aria-label="Next Level assistant"
        hidden={!open}
      >
        <header className="nl-head">
          <Image src="/logo.jpeg" alt="" width={36} height={36} />
          <div className="grow">
            <strong>Next Level Assistant</strong>
            <span>{listening ? "Listening…" : "Menu, prices, hours & bookings"}</span>
          </div>
          {ttsSupported && (
            <button
              className="nl-icon-btn"
              type="button"
              aria-pressed={speechOn}
              title={speechOn ? "Turn off spoken replies" : "Turn on spoken replies"}
              onClick={() => {
                setSpeechOn((v) => {
                  if (v) stopSpeaking();
                  return !v;
                });
              }}
            >
              {speechOn ? "🔊" : "🔇"}
            </button>
          )}
          <button
            className="nl-icon-btn"
            type="button"
            aria-label="Close chat"
            onClick={closePanel}
          >
            &#10005;
          </button>
        </header>

        <div className="nl-messages" ref={messagesRef} aria-live="polite">
          {messages.map((m) => (
            <div key={m.id} className={`nl-msg ${m.sender}`}>
              <div className="nl-bubble">
                <p>{m.text}</p>
                {m.action && (
                  <a className="nl-action" href={m.action.href}>
                    {m.action.label}
                  </a>
                )}
              </div>
            </div>
          ))}
          {typing && (
            <div className="nl-typing" aria-label="Assistant is typing">
              <span />
              <span />
              <span />
            </div>
          )}
          {listening && (
            <div className="nl-listening" aria-live="assertive">
              <span className="nl-listening-dot" /> Listening — speak now
            </div>
          )}
        </div>

        <div className="nl-suggestions">
          {SUGGESTIONS.map((s) => (
            <button
              key={s.label}
              type="button"
              className="nl-chip"
              onClick={() => send(s.text)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <form
          className="nl-form"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          {micSupported && (
            <button
              type="button"
              className={`nl-icon-btn${listening ? " listening" : ""}`}
              aria-label={listening ? "Stop listening" : "Speak your question"}
              aria-pressed={listening}
              title={listening ? "Stop listening" : "Speak your question"}
              onClick={toggleMic}
            >
              {listening ? "⏹" : "🎤"}
            </button>
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder="Ask about a dish, price, hours, the garden…"
            autoComplete="off"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="nl-send" aria-label="Send">
            &#10148;
          </button>
        </form>
      </div>
    </div>
  );
}
