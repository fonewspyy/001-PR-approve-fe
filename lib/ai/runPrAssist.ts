import { readFileSync } from "fs";
import { join } from "path";
import { coerceAiAssist, type AiAssist } from "./prAssist";
import { hasPdfPart, loadAttachmentParts } from "./prAttachments";
import { fetch8BitPromptState } from "@/lib/api/api8bit";
import type { PurchaseReq } from "@/lib/api/api8bit";

// Bundled default prompt — used only when the DB-managed prompt (begeworkflow
// "Set Prompt" screen) is unset or unreachable.
let cachedDefaultPrompt: string | null = null;
function getDefaultPrompt(): string {
  if (cachedDefaultPrompt !== null) return cachedDefaultPrompt;
  cachedDefaultPrompt = readFileSync(
    join(process.cwd(), "lib", "ai", "pr-assist-prompt.md"),
    "utf8"
  );
  return cachedDefaultPrompt;
}

// เพดานเวลาต่อ 1 ใบ = ฐาน 2 นาที + 1 นาทีต่อไฟล์แนบ (OCR ใช้เวลาตามจำนวนไฟล์) สูงสุด 10 นาที
// ปกติรุ่น :online ค้นเว็บด้วยใช้ ~30 วิ ถ้าเกินเพดานถือว่าค้าง ตัดทิ้ง ไม่งั้น worker ค้างทั้งรอบ
// ต้องสอดคล้องกับ 8Bit: PrAiWorker:TimeoutMinutes (30) >= Top (3) × เพดานสูงสุด (10 นาที)
const OPENROUTER_TIMEOUT_BASE_MS = 120_000;
const OPENROUTER_TIMEOUT_PER_FILE_MS = 60_000;
const OPENROUTER_TIMEOUT_MAX_MS = 600_000;

/** เวลาที่ยอมรอ OpenRouter สำหรับใบนี้ ตามจำนวนไฟล์แนบที่ส่งจริง */
function timeoutForFiles(fileCount: number): number {
  const wanted = OPENROUTER_TIMEOUT_BASE_MS + OPENROUTER_TIMEOUT_PER_FILE_MS * fileCount;
  return Math.min(wanted, OPENROUTER_TIMEOUT_MAX_MS);
}

// engine ที่ใช้แกะข้อความจาก PDF ฝั่ง OpenRouter
//   mistral-ocr   อ่านได้ทั้งไฟล์สแกนและไฟล์ที่มี text layer ($2 / 1,000 หน้า)
//   cloudflare-ai ฟรี แต่อ่านได้เฉพาะไฟล์ที่มี text layer
// ตั้ง default เป็น mistral-ocr เพราะใบเสนอราคามักเป็นไฟล์สแกน อ่านไม่ออกแล้วผลเพี้ยนแพงกว่าค่า OCR
const PDF_ENGINE = process.env.PR_AI_PDF_ENGINE?.trim() || "mistral-ocr";

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Compact the PR (already loaded from 8Bit) into the text the model reasons over. */
export function buildUserContent(data: PurchaseReq): string {
  const detail = Array.isArray(data.detail) ? data.detail : [];
  const dept = s(detail[0]?.costCenter) || s(detail[0]?.requisitioner);
  // ส่งทุกรายการ ไม่ตัดจำนวน — AI ต้องเห็นใบครบถึงจะประเมินได้ถูก
  const items = detail
    .map((d, i) =>
      [
        `#${i + 1}`,
        s(d.shortText),
        s(d.material) && `(material ${s(d.material)})`,
        s(d.quantity) && `จำนวน ${s(d.quantity)} ${s(d.unit)}`,
        s(d.valuationPrice) && `ราคา/หน่วย ${s(d.valuationPrice)}`,
        s(d.totalValue) && `รวม ${s(d.totalValue)}`,
        s(d.itemText) && `หมายเหตุ: ${s(d.itemText)}`,
        s(d.itemNote) && `note: ${s(d.itemNote)}`,
      ]
        .filter(Boolean)
        .join(" · ")
    )
    .join("\n");

  return [
    `เลขที่ PR: ${s(data.purchasingDocument) || "-"}`,
    `มูลค่ารวม: ${s(data.purTotalValue) || "-"}`,
    dept && `หน่วยงาน/แผนก (อ้างอิง): ${dept}`,
    s(data.headerNote) && `Header note: ${s(data.headerNote)}`,
    "",
    "รายการสินค้า/บริการ:",
    items || "(ไม่มีรายการ)",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export type RunPrAssistResult =
  | { ok: true; aiAssist: AiAssist; model: string; promptSource: "db" | "default" }
  | { ok: false; disabled: true; status: number; message: string }
  | { ok: false; disabled?: false; status: number; message: string; detail?: unknown };

/**
 * Analyse one PR with OpenRouter and return a validated AiAssist.
 * Prompt + model come from the DB ("Set Prompt" screen) when configured,
 * otherwise from the bundled default prompt / OPENROUTER_MODEL.
 * Shared by the on-demand route and the scheduled worker.
 */
export async function runPrAssist(data: PurchaseReq): Promise<RunPrAssistResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { ok: false, status: 500, message: "OPENROUTER_API_KEY is not configured." };
  }

  // Status ของแถว prompt ในหน้า Set Prompt = สวิตช์เปิด/ปิดฟีเจอร์
  const promptState = await fetch8BitPromptState();
  if (promptState.status === "inactive") {
    return {
      ok: false,
      disabled: true,
      status: 409,
      message: "AI Assist ถูกปิดใช้งาน (prompt สถานะ Inactive ในหน้า Set Prompt)",
    };
  }

  const dbPrompt = promptState.status === "active" ? promptState.prompt : null;
  let systemPrompt: string;
  let promptSource: "db" | "default";

  if (dbPrompt?.promptValue) {
    systemPrompt = dbPrompt.promptValue;
    promptSource = "db";
  } else {
    try {
      systemPrompt = getDefaultPrompt();
      promptSource = "default";
    } catch {
      return {
        ok: false,
        status: 500,
        message: "ไม่พบ prompt: ตั้งค่าไม่ได้จาก DB และไม่พบไฟล์ lib/ai/pr-assist-prompt.md",
      };
    }
  }

  const model =
    dbPrompt?.model || process.env.OPENROUTER_MODEL || "anthropic/claude-opus-5:online";

  // ไฟล์แนบ (ใบเสนอราคา/สเปค) — โหลดไม่ได้ก็วิเคราะห์ต่อจากข้อความอย่างเดียว
  let attachmentParts: Awaited<ReturnType<typeof loadAttachmentParts>> = [];
  try {
    attachmentParts = await loadAttachmentParts(data.attach);
  } catch (error) {
    console.warn("[runPrAssist] โหลดไฟล์แนบไม่สำเร็จ วิเคราะห์ต่อจากข้อความอย่างเดียว", error);
  }

  // ข้อความสรุปใบ PR มาก่อนเสมอ แล้วต่อด้วยไฟล์แนบ
  const userContent = [
    { type: "text" as const, text: buildUserContent(data) },
    ...attachmentParts,
  ];

  // เปิด file-parser เฉพาะตอนมี PDF จริง (รูปภาพโมเดลดูเองได้ ไม่ต้องผ่าน parser)
  const plugins = hasPdfPart(attachmentParts)
    ? [{ id: "file-parser", pdf: { engine: PDF_ENGINE } }]
    : undefined;

  const timeoutMs = timeoutForFiles(attachmentParts.length);

  try {
    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "http://localhost:3101",
        // ชื่อ header ตามสเปค OpenRouter คือ X-Title (ใช้แสดงชื่อแอปในหน้า activity)
        "X-Title": process.env.OPENROUTER_APP_NAME || "pr_approve",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        ...(plugins ? { plugins } : {}),
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

    const payload = (await upstream.json().catch(() => null)) as
      | { choices?: { message?: { content?: string } }[]; error?: unknown }
      | null;

    if (!upstream.ok) {
      return {
        ok: false,
        status: 502,
        message: "OpenRouter request failed.",
        detail: payload?.error ?? payload,
      };
    }

    const content = payload?.choices?.[0]?.message?.content ?? "";
    // Models sometimes wrap JSON in prose / ```json fences — extract the object.
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    let parsed: unknown = null;
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(content.slice(start, end + 1));
      } catch {
        parsed = null;
      }
    }

    const aiAssist = coerceAiAssist(parsed);
    if (!aiAssist) {
      return {
        ok: false,
        status: 502,
        message: "AI ตอบไม่ตรงรูปแบบ",
        detail: content.slice(0, 500),
      };
    }

    // ประทับเวลาที่ "เพิ่งดึงข้อมูล/วิเคราะห์เสร็จ" ตรงนี้ที่เดียว
    // ทั้ง worker และ fallback จึงบันทึกเวลาเดียวกันลง ResultJson
    const analyzedAt = new Date().toISOString();

    return { ok: true, aiAssist: { ...aiAssist, analyzedAt }, model, promptSource };
  } catch (error) {
    // AbortSignal.timeout โยน TimeoutError ออกมา แยกข้อความให้อ่านออกใน log/ตาราง
    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        ok: false,
        status: 504,
        message: `OpenRouter ไม่ตอบภายใน ${timeoutMs / 1000} วินาที`,
      };
    }

    return {
      ok: false,
      status: 500,
      message: error instanceof Error ? error.message : "Failed to call OpenRouter.",
    };
  }
}
