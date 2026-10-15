// Shared AI-Assist types + helpers used by both the client card (PrApproveView)
// and the server route (app/api/ai-assist). Kept framework-free so the server
// route can import it without pulling client-only code.

export const AI_DIMENSIONS = [
  { key: "necessity", label: "ความจำเป็น", short: "จำเป็น" },
  { key: "suitability", label: "ความเหมาะสม", short: "เหมาะสม" },
  { key: "value", label: "ความคุ้มค่า", short: "คุ้มค่า" },
  { key: "price", label: "ราคาเทียบตลาด", short: "ราคา" },
  { key: "evidence", label: "หลักฐาน/เอกสาร", short: "หลักฐาน" },
  { key: "urgency", label: "ความเร่งด่วน", short: "เร่งด่วน" },
] as const;

export type AiPriceSource = { store: string; name: string; url?: string; price: string };

export type AiLevel = "flag" | "warn" | "ok";

/** สิ่งที่ AI เสนอ — เก็บไว้เทียบกับคำตัดสินของคนเพื่อใช้เทรนในอนาคต */
export type AiDecision = "APPROVE" | "REJECT" | "REVIEW";

export type AiAssist = {
  level: AiLevel;
  levelText: string;
  decision: AiDecision;
  /** scores align with AI_DIMENSIONS order, 1–5 */
  scores: number[];
  reasons: string[];
  summary: string;
  advice: string;
  sources: AiPriceSource[];
  sourceNote: string;
  /** เวลาที่วิเคราะห์/เก็บผลใบนี้ (ISO 8601) — "" = แถวเก่าที่ยังไม่ได้บันทึกเวลาไว้ */
  analyzedAt: string;
};

/** คะแนนรายมุมที่ผู้อนุมัติให้ (score = null เมื่อไม่กรอกมุมนั้น) */
export type HumanDimScore = { key: string; score: number | null; reason: string };

/** คะแนนของผู้อนุมัติ 1 คน 1 ชั้น — เก็บใน ResultJson.$.humanScores (array) */
export type HumanScoreEntry = {
  level: number;
  by: string;
  at: string;
  action: AiDecision | "";
  dims: HumanDimScore[];
};

const LEVELS: AiLevel[] = ["flag", "warn", "ok"];
const DECISIONS: AiDecision[] = ["APPROVE", "REJECT", "REVIEW"];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * รับเฉพาะ timestamp ที่อ่านเป็นวันที่ได้จริง แล้วคืนรูปแบบ ISO มาตรฐาน
 * ค่าที่ใช้ไม่ได้ (ว่าง/ข้อความมั่ว/แถวเก่าที่ยังไม่มีฟิลด์นี้) → "" แล้วหน้าจอจะไม่แสดงเวลา
 */
function toIsoOrEmpty(v: unknown): string {
  const raw = str(v);
  if (!raw) return "";

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

/** clamp a score into 1–5; anything unusable becomes 3 (กลาง ๆ) */
function toScore(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
}

/**
 * Read the per-dimension scores/reasons.
 *
 * Preferred shape (current prompt) — one object per dimension, matched by `key`
 * so the order the model returns them in does not matter:
 *   "dimensions": [{ "seq":1, "key":"necessity", "score":5, "reason":"..." }, ...]
 *
 * Legacy shape (older prompt) — two parallel arrays, matched by index:
 *   "scores": [5,4,...], "reasons": ["...","..."]
 */
function readDimensions(o: Record<string, unknown>): { scores: number[]; reasons: string[] } {
  const dims = Array.isArray(o.dimensions) ? (o.dimensions as unknown[]) : null;

  if (dims && dims.length) {
    const byKey = new Map<string, Record<string, unknown>>();
    dims.forEach((d, i) => {
      if (!d || typeof d !== "object") return;
      const row = d as Record<string, unknown>;
      const key = str(row.key).toLowerCase();
      // key มาก่อน ถ้าไม่มีก็ใช้ seq/ตำแหน่งเป็นตัวสำรอง
      const seq = Number(row.seq);
      const fallbackKey = AI_DIMENSIONS[Number.isFinite(seq) ? seq - 1 : i]?.key ?? "";
      byKey.set(key || fallbackKey, row);
    });

    return {
      scores: AI_DIMENSIONS.map((dim) => toScore(byKey.get(dim.key)?.score)),
      reasons: AI_DIMENSIONS.map((dim) => str(byKey.get(dim.key)?.reason)),
    };
  }

  const scoresRaw = Array.isArray(o.scores) ? o.scores : [];
  const reasonsRaw = Array.isArray(o.reasons) ? o.reasons : [];
  return {
    scores: AI_DIMENSIONS.map((_, i) => toScore(scoresRaw[i])),
    reasons: AI_DIMENSIONS.map((_, i) => str(reasonsRaw[i])),
  };
}

/**
 * Validate + coerce an untrusted LLM JSON payload into a safe AiAssist.
 * Accepts the head/dimensions/sources shape (and the older flat shape),
 * clamps scores to 1–5 (length 6), and whitelists http(s) URLs.
 * Returns null when the payload has no usable content (caller should fall back).
 */
export function coerceAiAssist(raw: unknown): AiAssist | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  // head.* คือรูปแบบปัจจุบัน — ถ้าไม่มี head ก็อ่านจากระดับบนสุด (รูปแบบเดิม)
  const head =
    o.head && typeof o.head === "object" ? (o.head as Record<string, unknown>) : o;

  const level: AiLevel = LEVELS.includes(head.level as AiLevel)
    ? (head.level as AiLevel)
    : "warn";

  const decisionRaw = str(head.decision).toUpperCase() as AiDecision;
  const decision: AiDecision = DECISIONS.includes(decisionRaw)
    ? decisionRaw
    : level === "ok"
      ? "APPROVE"
      : level === "flag"
        ? "REJECT"
        : "REVIEW"; // ไม่ได้ระบุมา → เดาจาก level

  const { scores, reasons } = readDimensions(o);

  const sourcesRaw = Array.isArray(o.sources) ? o.sources : [];
  const sources: AiPriceSource[] = sourcesRaw
    .filter((s) => s && typeof s === "object")
    .map((s) => {
      const so = s as Record<string, unknown>;
      const url = str(so.url);
      return {
        store: str(so.store),
        name: str(so.name),
        price: str(so.price),
        url: /^https?:\/\//i.test(url) ? url : undefined,
      };
    })
    .filter((s) => s.store || s.name);

  const summary = str(head.summary);
  // Reject empty/garbage payloads so the caller uses its fallback instead.
  if (!summary && !reasons.some(Boolean)) return null;

  return {
    level,
    levelText: str(head.levelText) || "ผลวิเคราะห์จาก AI",
    decision,
    scores,
    reasons,
    summary,
    advice: str(head.advice),
    sources,
    sourceNote: str(head.sourceNote),
    // อ่านกลับจากแถวที่เก็บไว้; ผลสด runPrAssist จะประทับเวลาทับให้อีกที
    analyzedAt: toIsoOrEmpty(head.analyzedAt),
  };
}

/**
 * Read back a stored WF_PRAIResult.ResultJson (as returned by GET_DATA) into an
 * AiAssist. Runs through the same coercion as a live model reply, so an old or
 * hand-edited row can never break the page — it just renders as "no result".
 */
export function parseResultJson(stored: unknown): AiAssist | null {
  if (typeof stored !== "string" || stored.trim() === "") return null;

  try {
    return coerceAiAssist(JSON.parse(stored));
  } catch {
    return null; // แถวเสีย/ไม่ใช่ JSON — ให้หน้า PR ไป fallback เรียกสดแทน
  }
}

/** score ที่กรอกได้คือ 1-5 เท่านั้น อย่างอื่น (ไม่กรอก/มั่ว) = null */
function toHumanScore(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= 5 ? r : null;
}

/**
 * อ่าน $.humanScores (คะแนนรายมุมของผู้อนุมัติ) กลับจาก ResultJson ที่ GET_DATA ส่งมา
 * แยกจาก coerceAiAssist ตั้งใจ — AI กับ human คนละเจ้าของ ไม่ปนกันในโค้ด
 * แถวเก่า/ไม่มี key/เสีย → [] (หน้า PR แสดงช่องว่างให้กรอกใหม่)
 */
export function parseHumanScores(stored: unknown): HumanScoreEntry[] {
  if (typeof stored !== "string" || stored.trim() === "") return [];

  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return [];
  }

  const arr =
    raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).humanScores)
      ? ((raw as Record<string, unknown>).humanScores as unknown[])
      : [];

  return arr
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
    .map((e) => {
      const dimsRaw = Array.isArray(e.dims) ? (e.dims as unknown[]) : [];
      // เรียง dims ตาม AI_DIMENSIONS เสมอ เทียบกับคะแนน AI ตรงมุมได้
      const byKey = new Map<string, Record<string, unknown>>();
      dimsRaw.forEach((d) => {
        if (d && typeof d === "object") {
          const row = d as Record<string, unknown>;
          byKey.set(str(row.key).toLowerCase(), row);
        }
      });

      const levelNum = Number((e as Record<string, unknown>).level);
      const actionRaw = str(e.action).toUpperCase() as AiDecision;

      return {
        level: Number.isFinite(levelNum) ? levelNum : 0,
        by: str(e.by),
        at: str(e.at),
        action: DECISIONS.includes(actionRaw) ? actionRaw : "",
        dims: AI_DIMENSIONS.map((dim) => ({
          key: dim.key,
          score: toHumanScore(byKey.get(dim.key)?.score),
          reason: str(byKey.get(dim.key)?.reason),
        })),
      } satisfies HumanScoreEntry;
    });
}

/**
 * Serialise a validated AiAssist back into the canonical head/dimensions/sources
 * JSON that gets stored in WF_PRAIResult.ResultJson.
 *
 * Always store THIS (never the model's raw text): the DB view shreds
 * `$.dimensions` with OPENJSON, so the stored JSON must have that exact shape
 * even when the model replied in the older flat format.
 */
export function toResultJson(ai: AiAssist): string {
  return JSON.stringify({
    head: {
      level: ai.level,
      levelText: ai.levelText,
      decision: ai.decision,
      summary: ai.summary,
      advice: ai.advice,
      sourceNote: ai.sourceNote,
      // เก็บเวลาไว้ใน JSON เอง จะได้ไม่ต้องเพิ่มคอลัมน์ฝั่ง 8Bit
      analyzedAt: ai.analyzedAt,
    },
    dimensions: AI_DIMENSIONS.map((dim, i) => ({
      seq: i + 1,
      key: dim.key,
      name: dim.label,
      score: ai.scores[i] ?? 3,
      reason: ai.reasons[i] ?? "",
    })),
    sources: ai.sources.map((s, i) => ({
      seq: i + 1,
      store: s.store,
      name: s.name,
      url: s.url ?? "",
      price: s.price,
    })),
  });
}
