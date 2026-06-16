export const metadata = {
  title: "Gomoku",
  description: "Five in a row — play a friend online",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
