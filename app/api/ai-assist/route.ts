import { runPrAssist } from "@/lib/ai/runPrAssist";
import { toResultJson, type AiAssist } from "@/lib/ai/prAssist";
import { submit8BitAiResult, type PurchaseReq } from "@/lib/api/api8bit";

export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" } as const;

// Avoid re-calling the (paid, web-search) model for a PR already analysed this run.
const cache = new Map<string, AiAssist>();

/**
 * เก็บผลที่เพิ่งวิเคราะห์กลับเข้า WF_PRAIResult (write-through) เพื่อให้ครั้งต่อไป
 * GET_DATA ส่งมาให้เลย ไม่ต้องเรียก OpenRouter ซ้ำ
 *
 * บันทึกไม่สำเร็จไม่ถือว่าคำขอนี้ล้มเหลว — ผู้อนุมัติยังเห็นผลตามปกติ
 */
async function saveResult(
  processInstanceId: string,
  purchasingDocument: string,
  ai: AiAssist,
  model: string,
  promptSource: string
): Promise<void> {
  try {
    await submit8BitAiResult({
      ProcessInstanceId: processInstanceId,
      PurchasingDocument: purchasingDocument,
      ResultJson: toResultJson(ai),
      AiDecision: ai.decision,
      AiLevel: ai.level,
      AiModel: model,
      PromptSource: promptSource,
      AiStatus: "SUCCESS",
      AiErrorMessage: "",
    });
  } catch (error) {
    console.error("[ai-assist] write-through failed", processInstanceId, error);
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { data?: PurchaseReq; processInstanceId?: string }
    | null;
  const data = body?.data;
  if (!data || typeof data !== "object") {
    return Response.json({ message: "Expected { data: PurchaseReq }." }, { status: 400, headers: noStore });
  }

  const docNo = typeof data.purchasingDocument === "string" ? data.purchasingDocument.trim() : "";
  const processInstanceId = typeof body?.processInstanceId === "string" ? body.processInstanceId.trim() : "";

  const hit = docNo ? cache.get(docNo) : undefined;
  if (hit) {
    return Response.json({ aiAssist: hit, cached: true }, { headers: noStore });
  }

  const result = await runPrAssist(data);
  if (!result.ok) {
    // ปิดใช้งานอยู่ = ไม่ใช่ error → ตอบ 200 ให้หน้า PR ซ่อนการ์ด AI ไปเลย
    if (result.disabled) {
      return Response.json({ disabled: true, message: result.message }, { headers: noStore });
    }
    return Response.json(
      { message: result.message, error: "detail" in result ? result.detail : undefined },
      { status: result.status, headers: noStore }
    );
  }

  if (docNo) cache.set(docNo, result.aiAssist);

  // รอให้บันทึกเสร็จก่อนตอบ — Next ยกเลิก async งานค้างหลัง response จบ
  if (processInstanceId) {
    await saveResult(processInstanceId, docNo, result.aiAssist, result.model, result.promptSource);
  }

  return Response.json(
    { aiAssist: result.aiAssist, model: result.model, promptSource: result.promptSource },
    { headers: noStore }
  );
}
