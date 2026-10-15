// โหลดไฟล์แนบของ PR แล้วแปลงเป็น content part ที่ OpenRouter อ่านได้
//
// ไฟล์เก็บอยู่บนเครื่อง 8Bit เข้าถึงได้เฉพาะฝั่ง server ผ่าน fetch8BitFile
// (เบราว์เซอร์ไม่เคยเห็น token หรือ path จริง) โมดูลนี้จึงต้องถูกเรียกจาก
// route/worker เท่านั้น ห้าม import เข้า client component

import { fetch8BitFile, type PurAttach } from "@/lib/api/api8bit";

/** content part หนึ่งชิ้นในข้อความที่ส่งให้โมเดล */
export type PrAttachmentPart =
  | { type: "file"; file: { filename: string; file_data: string } }
  | { type: "image_url"; image_url: { url: string } };

// ไม่จำกัดจำนวนไฟล์ต่อใบ (ส่งทุกไฟล์ที่รองรับ) — คุมแค่ขนาดต่อไฟล์ด้านล่าง

/** ขนาดสูงสุดต่อไฟล์ (ก่อนแปลง base64 ซึ่งจะโตขึ้นอีก ~33%) กันไฟล์เดียวใหญ่ผิดปกติ */
const MAX_BYTES = 10 * 1024 * 1024;

/** นามสกุลรูปที่ส่งให้โมเดลดูตรง ๆ ได้ (ไม่ต้องผ่าน file-parser) */
const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** 8Bit เก็บ filePath ได้ 2 แบบ: URL เต็ม (eFlow) กับ path บนดิสก์ — เหมือนที่หน้า PR แยกอยู่แล้ว */
function isAbsoluteUrl(filePath: string): boolean {
  return /^https?:\/\//i.test(filePath);
}

/** ตัด query string ออกก่อน จะได้อ่านนามสกุลจาก URL ได้ถูก */
function pathPartOf(filePath: string): string {
  if (!isAbsoluteUrl(filePath)) return filePath;

  try {
    return new URL(filePath).pathname;
  } catch {
    return filePath;
  }
}

function extensionOf(filePath: string): string {
  const path = pathPartOf(filePath);
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function fileNameOf(filePath: string): string {
  const parts = pathPartOf(filePath).split(/[\\/]/);
  return parts[parts.length - 1] || "attachment";
}

/**
 * ดึงไฟล์เดียวจาก 8Bit แล้วแปลงเป็น data URL
 * คืน null เมื่อโหลดไม่ได้/ใหญ่เกิน — ผู้เรียกข้ามไฟล์นั้นไป ไม่ล้มทั้งใบ
 */
async function loadOne(filePath: string, mimeType: string): Promise<string | null> {
  // URL เต็ม = ไฟล์บนเซิร์ฟเวอร์ eFlow ดึงตรงได้เลย
  // ไม่ใช่ URL = path บนเครื่อง 8Bit ต้องผ่าน endpoint ที่ยืนยันตัวตนแล้ว
  const response = isAbsoluteUrl(filePath)
    ? await fetch(filePath, { cache: "no-store" })
    : await fetch8BitFile(filePath);

  if (!response.ok) {
    console.warn("[pr-attachments] โหลดไฟล์ไม่สำเร็จ", response.status, filePath);
    return null;
  }

  // เช็คขนาดจาก header ก่อนถ้ามี จะได้ไม่ต้องโหลดไฟล์ใหญ่มาทั้งก้อน
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_BYTES) {
    console.warn("[pr-attachments] ไฟล์ใหญ่เกิน ข้ามไป", declaredSize, filePath);
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    console.warn("[pr-attachments] ไฟล์ใหญ่เกิน ข้ามไป", buffer.byteLength, filePath);
    return null;
  }

  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

/**
 * แปลงไฟล์แนบของใบ PR เป็น content part
 *
 * - `.pdf`                    → part ชนิด file (ให้ file-parser แกะข้อความ)
 * - `.jpg/.jpeg/.png/.webp`   → part ชนิด image_url (โมเดลดูรูปตรง ๆ)
 * - นามสกุลอื่น (xlsx/docx/…) → ข้าม OpenRouter ไม่รองรับ
 *
 * ไฟล์ไหนโหลดไม่ได้ก็ข้ามไฟล์นั้น ไม่ทำให้การวิเคราะห์ทั้งใบล้ม
 */
export async function loadAttachmentParts(
  attachments: PurAttach[] | null | undefined
): Promise<PrAttachmentPart[]> {
  const rows = Array.isArray(attachments) ? attachments : [];
  const parts: PrAttachmentPart[] = [];
  let skippedUnsupported = 0;

  for (const row of rows) {
    const filePath = typeof row?.filePath === "string" ? row.filePath.trim() : "";
    if (!filePath) continue;

    const extension = extensionOf(filePath);
    const imageMime = IMAGE_MIME[extension];

    if (extension !== ".pdf" && !imageMime) {
      skippedUnsupported += 1;
      continue;
    }

    try {
      const dataUrl = await loadOne(filePath, imageMime ?? "application/pdf");
      if (!dataUrl) continue;

      if (imageMime) {
        parts.push({ type: "image_url", image_url: { url: dataUrl } });
      } else {
        parts.push({
          type: "file",
          file: { filename: fileNameOf(filePath), file_data: dataUrl },
        });
      }
    } catch (error) {
      console.warn("[pr-attachments] อ่านไฟล์ผิดพลาด ข้ามไป", filePath, error);
    }
  }

  console.info(
    `[pr-attachments] ไฟล์แนบ ${rows.length} รายการ → ส่งให้ AI ${parts.length} ไฟล์` +
      (skippedUnsupported ? ` (ข้ามชนิดที่ไม่รองรับ ${skippedUnsupported})` : "")
  );

  return parts;
}

/** มี part ชนิด file (PDF) อยู่มั้ย — ใช้ตัดสินว่าต้องเปิด plugin file-parser หรือไม่ */
export function hasPdfPart(parts: PrAttachmentPart[]): boolean {
  return parts.some((part) => part.type === "file");
}
