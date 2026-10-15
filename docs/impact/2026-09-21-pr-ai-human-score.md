# Impact Map + แผน — ผู้อนุมัติให้คะแนน AI รายมุม (Human score)

> สถานะ: **แผน ยังไม่ลงมือ** · วันที่ 2026-09-21 · ทำทีละขั้น รออนุมัติก่อนไปต่อ

## WHAT (ผู้ใช้เข้าใจ)
ในการ์ด "ผลตรวจโดย AI" เพิ่มให้ผู้อนุมัติใส่ **คะแนน 1-5 + เหตุผล ต่อทุกมุม (6 มุม)** เทียบกับคะแนนที่ AI ให้ แล้วเก็บลง `ResultJson` เพื่อใช้เทรน AI ในอนาคต (คนเห็นต่างจาก AI ตรงมุมไหน เพราะอะไร)

## กฎที่ยืนยันแล้วกับผู้ใช้ (2026-09-21)
1. ให้คะแนน **รายมุม 6 ช่อง** (ไม่ใช่ภาพรวม) — ตรง 1:1 กับตาราง AI
2. เก็บ **แยกตามผู้อนุมัติแต่ละชั้น** — เป็น array ไม่ทับกัน
3. บันทึก **ตอนกดอนุมัติ/ไม่อนุมัติ** ครั้งเดียว ล็อกเลย (ไม่มีปุ่ม Save แยก)

## Impact Map
| # | ช่อง | คำตอบ |
|---|---|---|
| 1 | WHAT | คะแนน+เหตุผลรายมุมของผู้อนุมัติ เก็บเทียบ AI |
| 2 | OWNER | `WF_PRAIResult.ResultJson` คีย์ใหม่ `$.humanScores` — แหล่งเดียว |
| 3 | READERS | การ์ด AI (แสดงย้อนถ้ามี), query/VIEW เทรนภายหลัง |
| 4 | WRITERS | ผู้อนุมัติผ่านการ์ด → endpoint ใหม่ → SP mode ใหม่เท่านั้น |
| 5 | CALLERS | `handleAction` (approve/reject) เรียกเพิ่ม 1 จุด (best-effort) |
| 6 | DATA | `WF_PRAIResult.ResultJson` แก้ในที่ **ไม่เพิ่มคอลัมน์ ไม่ migrate** |
| 7 | CONTRACT | เพิ่ม endpoint ใหม่ล้วน ไม่แตะ PRSubmit/GET_DATA/postMessage เดิม |
| 8 | RACE | read-modify-write JSON; **idempotent by level** (ยิงซ้ำชั้นเดิม = replace entry ไม่เพิ่มซ้ำ); merge ต้องไม่แตะ AI fields/entry ชั้นอื่น; **`SET_AI_RESULT` (re-analyze) ต้อง preserve `$.humanScores` ไม่ทับทั้ง blob** |
| 9 | HISTORY | ไม่กระทบเอกสารเก่า — แถวไม่มี `humanScores` ก็แสดงว่าง |
| 10 | TEST | ยิง endpoint → JSON มี entry ของ level นั้น; ยิงซ้ำ level เดิม → เหลือ entry เดียว; AI `$.dimensions` ไม่เปลี่ยน |
| 11 | OBSERVE | log ที่ endpoint + SP (level / by / จำนวนมุมที่กรอก) |
| 12 | ROLLBACK | `humanScores` เป็น key เสริม — ลบ key ทิ้งได้ไม่กระทบ AI; ถอดปุ่ม FE |
| 13 | DELETE | ไม่มีของเก่าต้องลบ (ฟีเจอร์ใหม่ทั้งหมด) |

**PDPA:** `humanScores[].by` = ชื่อผู้อนุมัติ = ข้อมูลบุคคล ใช้ audit/เทรนเท่านั้น ไม่โชว์ผู้ใช้ทั่วไป (กฎเดียวกับ `HumanDecisionBy`)

## รูปร่างข้อมูล — เพิ่มใน ResultJson (ไม่แตะ `$.dimensions` ของ AI)
```jsonc
{
  "head": { ... },          // เดิม ไม่แตะ
  "dimensions": [ ... ],     // เดิม (คะแนน AI) — VIEW ยัง shred $.dimensions ได้เหมือนเดิม
  "sources": [ ... ],        // เดิม
  "humanScores": [           // ⬅️ ใหม่ array ต่อผู้อนุมัติ
    {
      "level": 2,                          // = HumanApproveLevel / ReleaseSeq
      "by": "ชื่อผู้อนุมัติ",                  // PDPA
      "at": "2026-09-21T09:53:00Z",
      "action": "APPROVE",                 // อนุมัติหรือไม่ ตอนให้คะแนน
      "dims": [
        { "key": "necessity", "score": 4, "reason": "..." },
        ...ครบ 6 มุม (เว้นว่างได้ ถ้าไม่กรอก score=null)
      ]
    }
  ]
}
```
> เลือก key แยก `humanScores` ไม่ยัดเข้า `dimensions[]` เพราะ VIEW ปัจจุบัน `OPENJSON($.dimensions)` จะได้ไม่ต้องแก้ blast radius ต่ำสุด

## สิ่งที่ต้องแก้

### A. 8Bit (แนะนำ before→after ตอนลงมือ)
1. **SP mode ใหม่ `SET_AI_HUMAN_SCORE`** ใน `[WF_PRApprove]` — read-modify-write:
   อ่าน `ResultJson` ของ ProcessInstanceId → `JSON_MODIFY` เอา entry ที่ `level` ซ้ำออกก่อนแล้ว append entry ใหม่ → update กลับ · NVARCHAR ล้วน · มีบล็อก DEBUG
2. **endpoint ใหม่ `POST /PR/AiHumanScore`** ใน `PRController` (บาง ๆ mode-dispatch เหมือน AiResult) + DTO `ParamAiHumanScore`
3. **⚠ แก้ `SET_AI_RESULT` ให้ merge ไม่ทับทั้งก้อน (งานแฝง บังคับทำ)** — ปัจจุบันเขียนทับ `ResultJson` ทั้ง blob จาก worker (ซึ่งไม่มี `humanScores`) → **re-analyze ใบเดิมจะลบ `humanScores` ทิ้งเงียบ ๆ**
   แก้เป็น: เก็บ `$.humanScores` เดิมไว้ก่อน แล้ว `JSON_MODIFY` เฉพาะ `$.head`/`$.dimensions`/`$.sources` (หรือ merge humanScores เดิมกลับเข้า blob ใหม่) · ต้องมีเทสยืนยัน re-analyze แล้ว humanScores ไม่หาย

### B. pr_approve (Node/FE)
| ไฟล์ | แก้ |
|---|---|
| [lib/ai/prAssist.ts](pr_approve/lib/ai/prAssist.ts) | เพิ่ม type `HumanDimScore`/`humanScores` + อ่านกลับใน `coerceAiAssist`/`parseResultJson` (แถวเก่าไม่มี = []) |
| [lib/api/api8bit.ts](pr_approve/lib/api/api8bit.ts) | `submit8BitAiHumanScore()` → `POST {baseUrl}/PR/AiHumanScore` (แก้เฉพาะจุด ตาม memory api8bit-edit-scope) |
| [app/api/ai-human-score/route.ts](pr_approve/app/api/ai-human-score/route.ts) | ใหม่ รับ human scores → เรียก submit8BitAiHumanScore |
| [app/PrApproveView.tsx](pr_approve/app/PrApproveView.tsx) | state คะแนน/เหตุผลรายมุม · input ในตาราง (เฉพาะ `canAct`) · `handleAction` ยิง endpoint นี้ก่อน/คู่กับ pr-action (best-effort) |
| [app/globals.css](pr_approve/app/globals.css) | สไตล์ช่องกรอกในแถว (dropdown 13px ตาม memory dropdown-font-size) |

### C. ไม่แตะ
- `$.dimensions` ของ AI, VIEW ที่ shred มัน, PRSubmit/GET_DATA/GET_AI_PENDING/SET_AI_RESULT เดิม
- คอลัมน์ Human* (HumanDecision ฯลฯ) — คนละเรื่อง เป็น decision รวมใบที่ SP backfill อยู่แล้ว

## จุดตัดสินใจ (ฟันแล้ว)
- **best-effort** (ยืนยัน 2026-09-22) — บันทึกคะแนนไม่สำเร็จ **อนุมัติผ่านปกติ** คะแนนหายเฉย ๆ เพราะเป็น training data ไม่ใช่บันทึกธุรกิจ เหมือน write-through ของ ai-assist เดิม · FE ยิง endpoint คะแนน**ก่อน**เรียก pr-action แล้ว catch เงียบ ไม่บล็อกการอนุมัติ
- **UI:** เพิ่มช่องในตารางเดิม (score select + reason) ใต้/ข้างคะแนน AI แต่ละแถว ต้องออกแบบให้ไม่รก + responsive (memory responsive-multi-device) → ใช้ impeccable ตอนทำ FE

## พิสูจน์ (end-to-end)
1. เปิดหน้า PR จาก inbox (`source=inbox`) → เห็นช่องกรอกคะแนน 6 มุม
2. กรอกบางมุม กดอนุมัติ → `ResultJson.humanScores` มี entry ของ level ผู้อนุมัติ, มุมที่ไม่กรอก score=null
3. อนุมัติชั้นถัดไปให้คะแนนต่าง → มี 2 entries ไม่ทับกัน
4. ยิงซ้ำ level เดิม → ยังเหลือ entry เดียว (idempotent)
5. เปิด PR ที่ไม่ใช่ inbox → ไม่เห็นช่องกรอก (อ่านอย่างเดียว)
6. `tsc --noEmit` = 0

## ลำดับทำ (ทีละขั้น รออนุมัติ)
1. 8Bit: SP mode + endpoint + DTO → ทดสอบ Swagger
2. Node: type + api8bit + route ใหม่
3. FE: state + input ในตาราง + hook เข้า handleAction
4. FE polish (impeccable) + responsive + verify
