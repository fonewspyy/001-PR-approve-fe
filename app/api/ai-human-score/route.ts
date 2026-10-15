import { submit8BitAiHumanScore, type AiHumanScorePayload } from "@/lib/api/api8bit";
import type { HumanScoreEntry } from "@/lib/ai/prAssist";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" } as const;

/**
 * บันทึกคะแนนรายมุมของผู้อนุมัติลง ResultJson.$.humanScores
 *
 * เรียกแบบ best-effort จากหน้า PR ตอนกดอนุมัติ/ไม่อนุมัติ:
 * ถ้าพลาด หน้า PR จะไม่บล็อกการอนุมัติ (คะแนนเป็น training data ไม่ใช่บันทึกธุรกิจ)
 * route จึงตอบ error ตรง ๆ ให้ฝั่ง client เลือกกลืนเอง
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { processInstanceId?: string; level?: number; entry?: HumanScoreEntry }
    | null;

  const processInstanceId =
    typeof body?.processInstanceId === "string" ? body.processInstanceId.trim() : "";
  const entry = body?.entry;

  if (!processInstanceId || !entry || typeof entry !== "object") {
    return Response.json(
      { message: "Expected { processInstanceId, level, entry }." },
      { status: 400, headers: noStore }
    );
  }

  // level มาจาก entry เป็นหลัก (ชั้นอนุมัติที่กำลังทำ) — body.level เป็นตัวสำรอง
  const level = Number.isFinite(entry.level) ? entry.level : Number(body?.level) || 0;

  const payload: AiHumanScorePayload = {
    ProcessInstanceId: processInstanceId,
    Level: level,
    Entry: {
      level,
      by: typeof entry.by === "string" ? entry.by : "",
      at: typeof entry.at === "string" && entry.at ? entry.at : new Date().toISOString(),
      action: typeof entry.action === "string" ? entry.action : "",
      dims: Array.isArray(entry.dims)
        ? entry.dims.map((d) => ({
            key: typeof d?.key === "string" ? d.key : "",
            score: typeof d?.score === "number" ? d.score : null,
            reason: typeof d?.reason === "string" ? d.reason : "",
          }))
        : [],
    },
  };

  try {
    await submit8BitAiHumanScore(payload);
    return Response.json({ ok: true }, { headers: noStore });
  } catch (error) {
    console.error("[ai-human-score] บันทึกไม่สำเร็จ", processInstanceId, error);
    return Response.json(
      { ok: false, message: error instanceof Error ? error.message : "save failed" },
      { status: 502, headers: noStore }
    );
  }
}
