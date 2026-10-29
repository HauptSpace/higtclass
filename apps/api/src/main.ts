import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { DEFAULT_RULES, isRulePack, LOCALES } from "@higtclass/core";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { AssistantError, runAssistant, type AssistantRequest } from "./assistant.ts";

const app = new Hono();
// The web app (and later the desktop app) call this from another origin in development.
app.use("/api/*", cors({ origin: (process.env.ZIFRA_ORIGINS ?? "*").split(",") }));

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = hasKey ? new Anthropic() : null;

app.get("/api/health", (c) => c.json({ ok: true, assistant: hasKey }));

// Tips and deadlines ("Для вас"). Edit the JSON file on the server to update
// every app without a release; the bundled pack is the fallback.
app.get("/api/rules", async (c) => {
  const file = process.env.ZIFRA_RULES_FILE;
  if (file) {
    try {
      const pack: unknown = JSON.parse(await readFile(file, "utf8"));
      if (isRulePack(pack)) return c.json(pack);
      console.error("ZIFRA_RULES_FILE is not a valid rule pack");
    } catch (e) {
      console.error("Could not read ZIFRA_RULES_FILE", e);
    }
  }
  return c.json(DEFAULT_RULES);
});

app.post("/api/assistant", async (c) => {
  if (!client) return c.json({ error: "assistant_not_configured" }, 503);
  let body: AssistantRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad_request" }, 400);
  }
  if (typeof body?.message !== "string" || !body.workspace || !LOCALES.includes(body.settings?.locale)) {
    return c.json({ error: "bad_request" }, 400);
  }
  if (body.message.length > 4000 || (body.image && body.image.data.length > 7_000_000)) {
    return c.json({ error: "too_large" }, 413);
  }
  try {
    return c.json(await runAssistant(client, body));
  } catch (e) {
    if (e instanceof AssistantError) return c.json({ error: e.code }, 422);
    if (e instanceof Anthropic.RateLimitError) return c.json({ error: "busy" }, 429);
    if (e instanceof Anthropic.AuthenticationError) return c.json({ error: "assistant_not_configured" }, 503);
    if (e instanceof Anthropic.APIError) {
      console.error("Claude API error", e.status, e.message);
      return c.json({ error: "upstream" }, 502);
    }
    console.error(e);
    return c.json({ error: "internal" }, 500);
  }
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`Zifra API on http://localhost:${port} (assistant ${hasKey ? "on" : "off: set ANTHROPIC_API_KEY"})`);
