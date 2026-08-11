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
