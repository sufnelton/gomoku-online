# Gomoku Online

Five-in-a-row. Play the computer (5 levels), two players on one device, or a friend online with a shared 4-letter code.

## Run locally

```bash
npm install
npm run dev   # http://localhost:3000
```

Online play locally uses an in-memory store (no account needed) — open **two browser tabs** to test create + join.

## Deploy to Vercel (online play for real friends)

1. **Push to GitHub**

   ```bash
   git remote add origin https://github.com/<you>/gomoku-online.git
   git push -u origin main
   ```

2. **Import to Vercel** — vercel.com → Add New → Project → pick the repo → Deploy.

3. **Add the database** — In the Vercel project → **Storage** → **Create Database** → **Upstash for Redis** (free tier) → connect it to this project. This injects `KV_REST_API_URL` / `KV_REST_API_TOKEN` automatically.

4. **Redeploy** — Vercel → Deployments → ⋯ → Redeploy (so the new env vars apply).

5. **Share** — open the deployed URL, "Create game", send the 4-letter code to a friend.

> Without Upstash the app still runs, but online play won't work across devices in production (serverless instances don't share memory). The in-memory store is for local dev only.

## How online works

- The server (`/api/lobby`) is the referee: it stores the board, validates that it's your turn and your color, applies moves, and detects the win. Clients poll ~once a second.
- Your identity + current code live in `localStorage`, so a refresh drops you back into the same game.
- Black always moves first; the creator is Black. Rematch swaps colors.
```
