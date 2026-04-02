function env(name: string, fallback?: string) {
  const value = Deno.env.get(name);
  if (value == null || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function envNumber(name: string, fallback: number) {
  return Number(env(name, String(fallback)));
}

function json(value: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

function cookieValue(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return null;
  for (const chunk of cookieHeader.split(";")) {
    const [key, value] = chunk.trim().split("=");
    if (key === name) return value ?? null;
  }
  return null;
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  return atob(padded);
}

async function requireUserId(request: Request) {
  const jwtSecret = env("JWT_SECRET", "dev-secret");
  const cookieName = env("AUTH_COOKIE", "bezum_jwt");
  const token = cookieValue(request.headers.get("cookie"), cookieName);
  if (!token) return json({ ok: false, error: "Auth required." }, { status: 401 });
  const parts = token.split(".");
  if (parts.length !== 3) return json({ ok: false, error: "Auth required." }, { status: 401 });
  const [headerPart, payloadPart, signaturePart] = parts;
  const headerBytes = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const secretBytes = new TextEncoder().encode(jwtSecret);
  const key = await crypto.subtle.importKey("raw", secretBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, headerBytes);
  const expected = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  if (expected !== signaturePart) return json({ ok: false, error: "Auth required." }, { status: 401 });
  const payload = JSON.parse(decodeBase64Url(payloadPart));
  return payload?.user?.id ?? json({ ok: false, error: "Auth required." }, { status: 401 });
}

const port = envNumber("GAMES_PORT", 8006);

const games = [
  {
    id: "flappy-sky",
    title: "Flappy Sky",
    summary: "Thread a tiny bird through pastel towers and hold a streak above 10.",
    reward: 65,
    solveScore: 10,
  },
  {
    id: "ice-fishing",
    title: "Ice Fishing",
    summary: "Click to the rhythm and catch fish under neon ice.",
    reward: 35,
    solveScore: 60,
  },
  {
    id: "cart-dash",
    title: "Cart Dash",
    summary: "A popcorn cart races through the arcade.",
    reward: 50,
    solveScore: 60,
  },
  {
    id: "emoji-burst",
    title: "Emoji Burst",
    summary: "Assemble the correct reaction sequence.",
    reward: 20,
    solveScore: 60,
  },
];

console.log(`Games listening on http://localhost:${port}`);

Deno.serve({ port }, async (request) => {
  const url = new URL(request.url);

  if (url.pathname === "/health") {
    return json({ ok: true, service: "games" });
  }

  if (url.pathname === "/api/games/catalog") {
    return json({ ok: true, games });
  }

  const required = await requireUserId(request);
  if (required instanceof Response) return required;

  if (url.pathname.startsWith("/api/games/play/") && request.method === "POST") {
    const gameId = url.pathname.split("/").pop()!;
    const game = games.find((entry) => entry.id === gameId);
    if (!game) return json({ ok: false, error: "No game." }, { status: 404 });
    const payload = await request.json().catch(() => ({}));
    const score = Math.max(0, Math.min(100, Number(payload.score ?? 0)));
    const solved = score >= Number(game.solveScore ?? 60);
    const reward = solved ? game.reward : Math.round(game.reward / 2);
    return json({
      ok: true,
      gameId,
      score,
      reward,
      solved,
      milestone: score >= 10,
      message: solved ? "Run cleared." : "Keep pushing for a cleaner run.",
    });
  }

  return json({ ok: false, error: "Teapot games." }, { status: 418 });
});
