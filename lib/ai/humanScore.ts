// ตัวช่วยฝั่ง client สำหรับ "คะแนนรายมุมของผู้อนุมัติ" — รวมรูปร่าง entry + การส่งไว้ที่เดียว
// แยกจาก PrApproveView เพื่อให้ตรรกะการประกอบ/ส่งไม่ปนกับ UI และเรียกใช้ซ้ำได้

import { AI_DIMENSIONS, type HumanScoreEntry } from "./prAssist";

/** state ในหน้า: คะแนน+เหตุผลที่ผู้อนุมัติกรอก ต่อ key ของแต่ละมุม */
export type HumanDimInput = Record<string, { score: number | null; reason: string }>;

/** ค่าเริ่มต้น: ทุกมุมว่าง (score = null = ยังไม่กรอก) */
export function emptyHumanDims(): HumanDimInput {
  return Object.fromEntries(
    AI_DIMENSIONS.map((d) => [d.key, { score: null as number | null, reason: "" }])
  );
}

/**
 * ส่งคะแนนรายมุมของผู้อนุมัติแบบ best-effort — พังก็ไม่ throw ผู้เรียกไม่ต้อง try/catch
 * เจตนา: บันทึกตอนกดอนุมัติ ถ้าเน็ต/8Bit พลาด การอนุมัติต้องไปต่อได้ (เป็น training data ไม่ใช่บันทึกธุรกิจ)
 */
export async function submitHumanScore(args: {
  processInstanceId: string;
  level: number;
  by: string;
  action: "APPROVE" | "REJECT";
  dims: HumanDimInput;
}): Promise<void> {
  const entry: HumanScoreEntry = {
    level: args.level,
    by: args.by,
    at: new Date().toISOString(),
    action: args.action,
    // เรียงตาม AI_DIMENSIONS เสมอ เทียบกับคะแนน AI ตรงมุมได้
    dims: AI_DIMENSIONS.map((d) => ({
      key: d.key,
      score: args.dims[d.key]?.score ?? null,
      reason: (args.dims[d.key]?.reason ?? "").trim(),
    })),
  };

  try {
    await fetch("/001/api/ai-human-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        processInstanceId: args.processInstanceId,
        level: args.level,
        entry,
      }),
    });
  } catch {
    /* best-effort: กลืน error ไว้ ไม่ให้กระทบการอนุมัติ */
  }
}
