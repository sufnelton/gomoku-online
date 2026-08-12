import SceneLayer from "./SceneLayer.jsx";

export const metadata = {
  title: "Gomoku",
  description: "Five in a row — play a friend online",
};

// While the scene is on the page background becomes a scrim so the animation
// reads through it without costing legibility.
const themeCss = `
  :root { --app-bg: #1a1816; }
  body[data-scene="on"] { --app-bg: rgba(20, 18, 16, 0.52); }

  /* Touch hygiene. A drag across the board was competing with three browser
     defaults at once: dragging the stone sprite, selecting text under the
     finger, and iOS's long-press callout. All three are off inside the app
     chrome; chat messages stay selectable so text can still be copied. */
  /* Keeps pull-to-refresh and edge chaining out of the way of a drag. The
     document stays the scroller: locking it was solving a bounce that turned
     out to be a layout reflow, and cost more risk than it removed. */
  html, body { overscroll-behavior: none; }
  body { -webkit-tap-highlight-color: transparent; }
  button, .noselect, .noselect * {
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  img { -webkit-user-drag: none; user-drag: none; }
  button { -webkit-user-drag: none; }

  /* Glass surfaces. The look is a translucent panel that blurs and saturates
     what sits behind it, a bright hairline edge, and a highlight along the top
     inner edge so it reads as a lit pane rather than a flat tint. */
  .glass {
    background: rgba(255, 255, 255, 0.07);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.38),
      inset 0 1px 0 rgba(255, 255, 255, 0.20),
      inset 0 -1px 0 rgba(0, 0, 0, 0.18);
    position: relative;
    overflow: hidden;
  }
  /* A soft sheen across the top, which is what sells it as glass. */
  .glass::before {
    content: "";
    position: absolute;
    inset: 0 0 auto 0;
    height: 38%;
    background: linear-gradient(to bottom, rgba(255, 255, 255, 0.09), rgba(255, 255, 255, 0));
    pointer-events: none;
  }
  .glass > * { position: relative; }

  .glass-btn { transition: background 140ms ease, border-color 140ms ease, transform 100ms ease; }
  .glass-btn:hover { background: rgba(255, 255, 255, 0.13); border-color: rgba(255, 255, 255, 0.28); }
  .glass-btn:active { transform: scale(0.985); }

  .glass-accent {
    background: linear-gradient(160deg, rgba(26, 255, 140, 0.92), rgba(26, 255, 140, 0.72));
    border: 1px solid rgba(255, 255, 255, 0.35);
    box-shadow: 0 8px 26px rgba(26, 255, 140, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.55);
  }
  .glass-accent:hover { background: linear-gradient(160deg, rgba(26, 255, 140, 1), rgba(26, 255, 140, 0.82)); }

  @media (prefers-reduced-transparency: reduce) {
    .glass { background: rgba(26, 24, 22, 0.92); backdrop-filter: none; -webkit-backdrop-filter: none; }
    .glass::before { display: none; }
  }

  /* Stones settle in when placed. The keyframes carry the centring transform,
     since animating transform would otherwise drop it mid-flight. */
  @keyframes pieceIn {
    from { opacity: 0; transform: translate(-50%, -50%) scale(0.55); }
    65%  { opacity: 1; transform: translate(-50%, -50%) scale(1.07); }
    to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
  }
  .pc { animation: pieceIn 170ms cubic-bezier(0.34, 1.4, 0.64, 1) both; }
  @media (prefers-reduced-motion: reduce) { .pc { animation: none; } }
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#1a1816" }}>
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
        <SceneLayer />
        {children}
      </body>
    </html>
  );
}
