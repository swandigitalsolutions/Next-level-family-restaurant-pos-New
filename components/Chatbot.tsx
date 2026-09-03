"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { GREETING, SUGGESTIONS, answer } from "@/lib/chatbot-kb";

type Msg = {
  id: number;
  sender: "bot" | "user";
  text: string;
  action?: { label: string; href: string };
};

let nextId = 1;

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [typing, setTyping] = useState(false);
  const [speechOn, setSpeechOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [input, setInput] = useState("");
  const [micSupported, setMicSupported] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);

  const greetedRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const speechOnRef = useRef(speechOn);
  speechOnRef.current = speechOn;

  /* ---- feature detection + speech recognition wiring (once) ---- */
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSpeechSupported("speechSynthesis" in window);

    const Ctor =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (Ctor) {
      setMicSupported(true);
      const rec = new Ctor();
      rec.lang = "en-IN";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.addEventListener("result", (e: any) => {
        const transcript = e.results?.[0]?.[0]?.transcript ?? "";
        if (transcript) send(transcript);
      });
      const stop = () => setListening(false);
      rec.addEventListener("end", stop);
      rec.addEventListener("error", stop);
      recognitionRef.current = rec;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function speak(text: string) {
    if (!speechOnRef.current || typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1;
      u.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const en = voices.find((v) => /^en(-|_)?(IN|GB|US)?/i.test(v.lang));
      if (en) u.voice = en;
      window.speechSynthesis.speak(u);
    } catch {
      /* environments without TTS */
    }
  }

  function push(m: Omit<Msg, "id">) {
    setMessages((prev) => [...prev, { ...m, id: nextId++ }]);
  }

  function send(raw: string) {
    const text = raw.trim();
    if (!text) return;
    push({ sender: "user", text });
    setInput("");
    setTyping(true);
    window.setTimeout(() => {
      setTyping(false);
      const a = answer(text);
      push({ sender: "bot", text: a.text, action: a.action });
      speak(a.text);
    }, 420 + Math.random() * 300);
  }

  function openPanel() {
    setOpen(true);
    if (!greetedRef.current) {
      greetedRef.current = true;
      push({ sender: "bot", text: GREETING });
      // Prime the voice list (some browsers load it lazily).
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.getVoices();
      }
      speak(GREETING);
    }
    window.setTimeout(() => inputRef.current?.focus(), 150);
  }

  function closePanel() {
    setOpen(false);
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function toggleMic() {
    const rec = recognitionRef.current;
    if (!rec) return;
    if (listening) {
      rec.stop();
      return;
    }
    try {
      rec.start();
      setListening(true);
    } catch {
      /* already started */
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
            <span>Menu, prices, hours &amp; bookings</span>
          </div>
          {speechSupported && (
            <button
              className="nl-icon-btn"
              type="button"
              aria-pressed={speechOn}
              title="Toggle spoken replies"
              onClick={() => {
                setSpeechOn((v) => {
                  if (v && "speechSynthesis" in window)
                    window.speechSynthesis.cancel();
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
          <button
            type="button"
            className={`nl-icon-btn${listening ? " listening" : ""}`}
            aria-label="Speak your question"
            title={
              micSupported
                ? "Speak your question"
                : "Voice input needs Chrome or Edge"
            }
            disabled={!micSupported}
            onClick={toggleMic}
          >
            &#127908;
          </button>
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
