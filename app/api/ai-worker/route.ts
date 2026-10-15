import { runPrAssist } from "@/lib/ai/runPrAssist";
import { toResultJson } from "@/lib/ai/prAssist";
import {
  fetch8BitAiPending,
  fetch8BitPRApprove,
  fetch8BitPromptState,
  submit8BitAiResult,
  type AiPendingHeader,
  type AiPendingItem,
  type PurAttach,
  type PurchaseReq,
} from "@/lib/api/api8bit";

export const runtime = "nodejs";
// การวิเคราะห์หลายใบ + ค้นเว็บ ใช้เวลานาน — ขยายเพดานเวลาให้ worker
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" } as const;

/** กันคนนอกยิง worker — scheduler ต้องส่ง header นี้มาให้ตรงกับ env */
function isAuthorized(req: Request): boolean {
  const expected = process.env.AI_WORKER_SECRET?.trim();
  if (!expected) return false; // ไม่ตั้ง secret = ปิดไว้ก่อน ปลอดภัยกว่าเปิดโล่ง
  return req.headers.get("x-worker-secret")?.trim() === expected;
}

/**
 * ประกอบ header + รายการสินค้าของใบเดียว ให้อยู่ในรูปที่ runPrAssist ใช้ได้
 * (ใช้เฉพาะฟิลด์ที่ buildUserContent อ่าน จึง cast เป็น PurchaseReq ได้)
 */
/**
 * ดึงรายการไฟล์แนบของใบนั้นจาก mode GET_DATA (mode เดิมที่หน้า PR ใช้)
 * คิว GET_AI_PENDING ไม่ได้คืนไฟล์แนบมาด้วย จึงต้องถามเพิ่มอีกครั้ง
 *
 * ถามไม่สำเร็จ = วิเคราะห์ต่อจากข้อความอย่างเดียว ไม่ให้ล้มทั้งใบ
 */
async function fetchAttachments(processInstanceId: string): Promise<PurAttach[]> {
  try {
    const pr = await fetch8BitPRApprove(processInstanceId);
    return Array.isArray(pr?.attach) ? pr.attach : [];
  } catch (error) {
    console.warn("[ai-worker] ดึงไฟล์แนบไม่สำเร็จ", processInstanceId, error);
    return [];
  }
}

function toPurchaseReq(
  header: AiPendingHeader,
  items: AiPendingItem[],
  attach: PurAttach[]
): PurchaseReq {
  return {
    purchasingDocument: header.purchasingDocument,
    purTotalValue: header.purTotalValue,
    headerNote: header.headerNote,
    attach,
    detail: items.map((item) => ({
      shortText: item.shortText ?? "",
      material: item.material ?? "",
      quantity: item.quantity ?? "",
      unit: item.unit ?? "",
      valuationPrice: item.valuationPrice ?? "",
      totalValue: item.totalValue ?? "",
      itemText: item.itemText ?? "",
      itemNote: item.itemNote ?? "",
      requisitioner: item.requisitioner ?? "",
      costCenter: item.costCenter ?? "",
    })),
  } as unknown as PurchaseReq;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ message: "Unauthorized" }, { status: 401, headers: noStore });
  }

  // จำนวนใบสูงสุดต่อรอบ — คุมค่าใช้จ่าย/เวลาไม่ให้บานปลาย
  const body = (await req.json().catch(() => null)) as { top?: number } | null;
  // default 3 ให้ตรงกับ 8Bit PrAiWorker:Top (ใบหนึ่งอาจนานถึง 10 นาทีเมื่อไฟล์แนบเยอะ)
  const top = Math.min(Math.max(Number(body?.top) || 3, 1), 20);

  const started = Date.now();

  // สวิตช์เปิด/ปิด job = Status ของแถว prompt ในหน้า Set Prompt
  // ปิดอยู่ → ไม่ต้องดึงคิวและไม่เรียก LLM เลย
  const promptState = await fetch8BitPromptState();
  if (promptState.status === "inactive") {
    return Response.json(
      {
        disabled: true,
        done: 0,
        failed: 0,
        took: Date.now() - started,
        message: "AI Assist ถูกปิดใช้งาน (prompt สถานะ Inactive ในหน้า Set Prompt)",
      },
      { headers: noStore }
    );
  }

  let pending: { headers: AiPendingHeader[]; items: AiPendingItem[] };

  try {
    pending = await fetch8BitAiPending(top);
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "AiPending failed" },
      { status: 502, headers: noStore }
    );
  }

  if (pending.headers.length === 0) {
    return Response.json(
      { done: 0, failed: 0, took: Date.now() - started, message: "ไม่มีใบที่รอวิเคราะห์" },
      { headers: noStore }
    );
  }

  // จัดกลุ่มรายการสินค้าตามใบ (เรียก 1 ครั้ง ไม่วน find ซ้ำ)
  const itemsByPr = new Map<string, AiPendingItem[]>();
  for (const item of pending.items) {
    const list = itemsByPr.get(item.processInstanceId);
    if (list) list.push(item);
    else itemsByPr.set(item.processInstanceId, [item]);
  }

  const results: { processInstanceId: string; ok: boolean; decision?: string; error?: string }[] = [];

  const total = pending.headers.length;
  console.info(`[ai-worker] เริ่มรอบ คิว ${total} ใบ (ขอมา top=${top})`);

  // ทำทีละใบ (ไม่ยิงพร้อมกัน) กัน rate-limit ของ OpenRouter
  for (const [index, header] of pending.headers.entries()) {
    const pid = header.processInstanceId;
    // คำนำหน้า log ทุกบรรทัดของใบนี้ — ตามดูสดได้ว่าค้างที่ใบไหน
    const step = `[ai-worker] ${index + 1}/${total}`;
    const docNo = header.purchasingDocument || pid;
    const prStartedAt = Date.now();

    const attach = await fetchAttachments(pid);
    const pr = toPurchaseReq(header, itemsByPr.get(pid) ?? [], attach);

    console.info(`${step} กำลังวิเคราะห์ ${docNo} (ไฟล์แนบ ${attach.length})`);

    /** วินาทีที่ใช้กับใบนี้ ทศนิยม 1 ตำแหน่ง */
    const elapsed = () => Math.round((Date.now() - prStartedAt) / 100) / 10;

    try {
      const analysis = await runPrAssist(pr);

      if (!analysis.ok) {
        // วิเคราะห์ไม่สำเร็จ → บันทึกสถานะ FAILED ไว้ให้ retry/ตรวจสอบได้
        await submit8BitAiResult({
          ProcessInstanceId: pid,
          PurchasingDocument: header.purchasingDocument,
          ResultJson: "",
          AiDecision: "",
          AiLevel: "",
          AiModel: "",
          PromptSource: "",
          AiStatus: "FAILED",
          AiErrorMessage: analysis.message.slice(0, 900),
        });
        console.error(`${step} พลาด ${docNo}: ${analysis.message} ใช้ ${elapsed()} วิ`);
        results.push({ processInstanceId: pid, ok: false, error: analysis.message });
        continue;
      }

      await submit8BitAiResult({
        ProcessInstanceId: pid,
        PurchasingDocument: header.purchasingDocument,
        // เก็บโครงมาตรฐานเสมอ (ไม่ใช่ raw จาก AI) เพื่อให้ VIEW แตก dimensions ได้
        ResultJson: toResultJson(analysis.aiAssist),
        AiDecision: analysis.aiAssist.decision,
        AiLevel: analysis.aiAssist.level,
        AiModel: analysis.model,
        PromptSource: analysis.promptSource,
        AiStatus: "SUCCESS",
        AiErrorMessage: "",
      });

      console.info(
        `${step} เสร็จ ${docNo} decision=${analysis.aiAssist.decision} ใช้ ${elapsed()} วิ`
      );
      results.push({ processInstanceId: pid, ok: true, decision: analysis.aiAssist.decision });
    } catch (error) {
      // เช่น บันทึกลง 8Bit ไม่ได้ — ไม่ให้ล้มทั้งรอบ ใบถัดไปทำต่อ
      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`${step} พลาด ${docNo}: ${message} ใช้ ${elapsed()} วิ`);
      results.push({ processInstanceId: pid, ok: false, error: message });
    }
  }

  const done = results.filter((r) => r.ok).length;
  const took = Date.now() - started;

  console.info(
    `[ai-worker] จบรอบ สำเร็จ ${done} ใบ พลาด ${results.length - done} ใบ ` +
      `รวม ${Math.round(took / 100) / 10} วิ`
  );

  return Response.json(
    { done, failed: results.length - done, took, results },
    { headers: noStore }
  );
}
