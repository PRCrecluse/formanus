import { createClient } from "@supabase/supabase-js";
import { readdir, readFile } from "fs/promises";
import path from "path";

const PROMPT_ROOT = path.join(process.cwd(), "prompts");
const PROMPT_ROOT_RESOLVED = path.resolve(PROMPT_ROOT);
const CACHE_TTL_MS = 2000;

/**
 * AIPersona Strategic Orchestrator System Prompt
 * This is the core "brain" of the agent, optimized for multi-step task orchestration,
 * social media management, and automated workflows.
 */
export const AIPERSONA_SYSTEM_PROMPT = `
# Role: AIPersona Strategic Orchestrator

## Background
You are a high-level AI Orchestrator within the AIPersona platform. Your purpose is to bridge user intent with the platform's technical capabilities, including content generation, social media management (X/Twitter), automated workflows, and competitive intelligence.

## Operational Objectives
Transform vague user requests into precise, multi-step execution plans. You must autonomously coordinate between specialized skills while maintaining a "Human-in-the-loop" approach for sensitive operations.

## Core Directives

### 1. Multi-Step Task Orchestration
Break down complex requests into a sequential TaskGraph. 
- Example: "Write an article about AI and tweet it" -> [Step 1: Content Generation] -> [Step 2: Save to Board Resources] -> [Step 3: Account Selection Interaction] -> [Step 4: Social Posting].

### 2. Human-in-the-loop (HITL) Protocol
You MUST pause execution and request user input in the following scenarios:
- Account Selection: Before posting to social media, list available accounts (using list-twitter-accounts) and ask the user to specify the target.
- Confirmation with Timeout: For automated tasks (e.g., creating a new automation), present a JSON/UI preview. Explicitly state: "I will proceed with this configuration in 10 seconds unless you specify otherwise."
- Sensitive Operations: Any operation that incurs significant credits or modifies public profiles.

### 3. State Management & Feedback
- Use "info" messages to provide real-time status updates (e.g., "Step 1/4: Researching competitor accounts...").
- Always provide actionable links or IDs upon completion (e.g., Document ID, Tweet URL).

### 4. Intent-to-Skill Mapping
- Content Creation: Use "article-writing-and-posting" or chain "generate-content" + "create-board-doc".
- Automation: Map natural language (e.g., "Every morning at 9am") to standard Cron (e.g., "0 9 * * *").
- Competitive Intelligence: 
    - X/Twitter: Use "competitor-analysis" (handles -> similarity matching -> hot content aggregation).
    - WeChat/Notion: Use "wechat-competitor-collection" (Notion page reading -> structured document generation).

## Interaction Patterns

### Case A: Social Posting
1. Identify the topic.
2. Generate content and save it to persona_docs via create-board-doc.
3. Call list-twitter-accounts.
4. ASK: "I've prepared your article (Doc ID: {id}). Which X account should I use to post the summary? [List accounts]."
5. Upon user response, execute post-to-twitter.

### Case B: Automation Creation
1. Parse the frequency and task.
2. Generate the AutomationDoc structure.
3. INFO: Display a preview of the automation (Name, Cron, Actions).
4. Implement a 10-second auto-confirm logic before calling the POST /api/automations endpoint.
`.trim();

type CacheEntry = { value: string; at: number };

const promptCache = new Map<string, CacheEntry>();

function getSupabaseServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").toString().trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function resolvePromptPath(name: string) {
  const candidate = path.resolve(PROMPT_ROOT, name);
  if (!candidate.startsWith(`${PROMPT_ROOT_RESOLVED}${path.sep}`)) {
    throw new Error("invalid_prompt_name");
  }
  return candidate;
}

export function clearPromptCache(name?: string) {
  if (!name) {
    promptCache.clear();
    return;
  }
  promptCache.delete(name);
}

export function extractPromptVariables(template: string) {
  const out = new Set<string>();
  const re = /\{([a-zA-Z0-9_]+)\}/g;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(template))) {
    const key = (m[1] ?? "").toString().trim();
    if (key) out.add(key);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

export function fillPromptTemplate(template: string, vars: Record<string, string>) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return out;
}

export async function listPromptFiles(): Promise<string[]> {
  try {
    const items = await readdir(PROMPT_ROOT, { withFileTypes: true });
    return items
      .filter((d) => d.isFile())
      .map((d) => d.name)
      .filter((name) => /^[a-zA-Z0-9._-]+$/.test(name));
  } catch {
    return [];
  }
}

async function loadPromptFromFile(name: string) {
  try {
    const filePath = resolvePromptPath(name);
    const text = await readFile(filePath, "utf8");
    return text.toString();
  } catch {
    return "";
  }
}

async function loadPromptFromCloud(name: string) {
  const supabase = getSupabaseServiceClient();
  if (!supabase) return "";
  try {
    const { data, error } = await supabase.from("prompt_templates").select("content").eq("id", name).maybeSingle();
    if (error) return "";
    const content = (data as { content?: unknown } | null)?.content;
    return typeof content === "string" ? content.toString() : "";
  } catch {
    return "";
  }
}

export async function loadPromptTemplate(name: string) {
  const key = (name ?? "").toString().trim();
  if (!key) return "";
  const now = Date.now();
  const cached = promptCache.get(key);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;

  const cloud = await loadPromptFromCloud(key);
  if (cloud) {
    promptCache.set(key, { value: cloud, at: now });
    return cloud;
  }

  const file = await loadPromptFromFile(key);
  promptCache.set(key, { value: file, at: now });
  return file;
}
