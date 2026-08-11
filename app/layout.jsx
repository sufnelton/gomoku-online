import SceneLayer from "./SceneLayer.jsx";

export const metadata = {
  title: "Gomoku",
  description: "Five in a row — play a friend online",
};

// While the scene is on the page background becomes a scrim so the animation
// reads through it without costing legibility.
const themeCss = `
  :root { --app-bg: #1a1816; }
  body[data-scene="on"] { --app-bg: rgba(22, 20, 18, 0.80); }

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
