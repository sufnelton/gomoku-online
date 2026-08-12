"use client";
import React, { useState, useRef, useEffect } from "react";

export default function ChatPanel({ messages, myColor, names, onSend, disabled, height }) {
  const [text, setText] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };

  const oppName = names ? (myColor === "black" ? names.white : names.black) : null;

  return (
    <div className="glass" style={{
      display: "flex", flexDirection: "column", width: "100%", maxWidth: 300, height: height || 300,
      borderRadius: 14, overflow: "hidden",
    }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,.14)", fontSize: 13, fontWeight: 700, color: "#f2ede4" }}>
        Chat {oppName ? <span style={{ color: "#b5aea2", fontWeight: 500 }}>· with {oppName}</span> : null}
      </div>

      <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ color: "#9c9488", fontSize: 12, margin: "auto", textAlign: "center" }}>
            {disabled ? "Waiting for your opponent…" : "Say hi 👋"}
          </div>
        )}
        {messages.map((m) => {
          const mine = m.color === myColor;
          return (
            <div key={m.seq} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
              <div style={{ fontSize: 10, color: mine ? "#1AFF8C" : "#b5aea2", marginBottom: 2 }}>{m.name}</div>
              <div style={{
                maxWidth: "85%", padding: "6px 10px", borderRadius: 9, fontSize: 13, lineHeight: 1.35,
                color: "#f2ede4", background: mine ? "rgba(26,255,140,0.12)" : "#1f1c19",
                border: `1px solid ${mine ? "rgba(26,255,140,0.3)" : "#3a3530"}`, wordBreak: "break-word",
              }}>
                {m.text}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #3a3530" }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={disabled ? "Waiting…" : "Message"}
          disabled={disabled}
          maxLength={200}
          className="glass" style={{ flex: 1, padding: "9px 11px", borderRadius: 11, color: "#f2ede4", fontSize: 13, outline: "none" }}
        />
        <button onClick={send} disabled={disabled}
          style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #1AFF8C", background: disabled ? "#2a2723" : "#1AFF8C", color: disabled ? "#9c9488" : "#15110d", fontSize: 13, fontWeight: 700, cursor: disabled ? "default" : "pointer" }}>
          Send
        </button>
      </div>
    </div>
  );
}
