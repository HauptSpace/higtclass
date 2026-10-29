import Anthropic from "@anthropic-ai/sdk";
import { describeWorkspace, todayISO, type Op, type Settings, type Workspace } from "@higtclass/core";
import { applyOutcome, runTool, TOOLS } from "./tools.ts";

export const MODEL = process.env.ZIFRA_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.ZIFRA_EFFORT ?? "low") as "low" | "medium" | "high";
const MAX_TURNS = 6;

const SYSTEM = `You are the assistant inside Zifra, a table app for everyone from a street vendor to a CEO.
People tell you in plain words — often dictated, sometimes with a photo of a receipt or document — what happened, and you turn it into table changes with the tools.

How to work:
- Use the workspace context in the message. Prefer the active table; otherwise pick the table that clearly fits.
- Use exact column names. Resolve relative dates ("yesterday", "в пятницу", "gestern") against today's date in the context and write them as YYYY-MM-DD. Write amounts as plain numbers ("120 тысяч" → 120000). Fill only what you are confident about.
- For select columns reuse an existing option when one fits; otherwise use a short new one.
- When someone reports a change to something already recorded ("Альфа оплатила заказ"), find the row in recent_rows and update it instead of adding a duplicate.
- A receipt photo usually becomes one row per purchase or one row with the total — choose what matches the table's columns.
- Never delete anything unless explicitly asked.
- If no table fits, or the person asks for a new table, create one with 3–7 well-typed columns named in the person's language.
- If the request is too unclear to act on, ask one short question instead of calling tools.

Nothing is saved until the person confirms, so after the tool calls reply with one short sentence in the person's language describing what you prepared. No markdown.`;

const BUILD_HINT =
  "The person is setting up a new table from a description. Design it with create_table (typed columns, sensible select options, a formula only where it clearly helps). Add example rows only if the description contains real data.";

export interface AssistantRequest {
  message: string;
  image?: { mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string };
  mode?: "entry" | "build";
  activeTableId?: string | null;
  workspace: Workspace;
  settings: Settings;
}

export interface AssistantResponse {
  reply: string;
  ops: Op[];
}

/** The slice of the SDK this module uses — lets tests pass a fake client. */
export interface MessagesClient {
  beta: { messages: { create: (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage> } };
}

export class AssistantError extends Error {
  code: "refused" | "truncated" | "too_many_steps";
  constructor(code: AssistantError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export async function runAssistant(client: MessagesClient, req: AssistantRequest, now = new Date()): Promise<AssistantResponse> {
  const today = todayISO(now);
  const ctx = { locale: req.settings.locale, now };
  let ws = req.workspace;
  const ops: Op[] = [];

  const context = describeWorkspace(ws, req.settings, { activeTableId: req.activeTableId, today });
  const userContent: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.image) {
    userContent.push({ type: "image", source: { type: "base64", media_type: req.image.mediaType, data: req.image.data } });
  }
  userContent.push({
    type: "text",
    text: `<workspace>\n${JSON.stringify(context)}\n</workspace>\n${req.mode === "build" ? `${BUILD_HINT}\n` : ""}\n${req.message}`,
  });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: userContent }];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: EFFORT },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") throw new AssistantError("refused", "The request was declined.");
    if (response.stop_reason === "max_tokens") throw new AssistantError("truncated", "The answer was cut off.");

    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      const reply = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();
      return { reply, ops };
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((use) => {
      const outcome = runTool(ws, use.name, use.input, ctx);
      if (outcome.op) {
        ws = applyOutcome(ws, outcome);
        ops.push(outcome.op);
      }
      return {
        type: "tool_result",
        tool_use_id: use.id,
        is_error: !outcome.ok,
        content: JSON.stringify(outcome.result),
      };
    });
    messages.push({ role: "user", content: results });
  }
  throw new AssistantError("too_many_steps", "The assistant took too many steps.");
}
