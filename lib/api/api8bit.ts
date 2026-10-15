import { get8BitApiBaseUrl } from '@/lib/config';
import { getMicrosoftOAuthToken } from '@/lib/auth/oauth';

export interface PurDetail {
  itemNo: string;
  material: string;
  shortText: string;
  quantity: string;
  unit: string;
  deliveryDate: string;
  materialGroup: string;
  plant: string;
  storLocation: string;
  purchaseGroup: string;
  requisitioner: string;
  accAssCat: string;
  gL_Account: string;
  costCenter: string;
  distribution: string;
  coCode: string;
  createdBySAP: string;
  valuationPrice: string;
  totalValue: string;
  itemText: string;
  itemNote: string;
  deliveryText: string;
  materialPOText: string;
  fk: string;
}

export interface PurAttach {
  filePath: string;
  title: string;
  createdbySAP: string;
  createdOnSAP: string;
  fk: string;
}

export interface PurReleaseStrategy {
  releaseGroup: string;
  releaseStrategy: string;
  releaseIndicator: string;
  releaseSeq: string;
  code: string;
  description: string;
  userName: string;
  processor: string;
  status: string;
  fk: string;
}

export interface PRApprovalStatus {
  processInstanceId: string;
  TaskID?: string;
  purchasingDocument: string;
  app_Approve1: string;
  app_Approve2: string;
  app_Approve3: string;
  app_Approve4: string;
  app_Approve5: string;
  app_Approve6: string;
  app_Approve7: string;
  fullname_Approve1: string;
  fullname_Approve2: string;
  fullname_Approve3: string;
  fullname_Approve4: string;
  fullname_Approve5: string;
  fullname_Approve6: string;
  fullname_Approve7: string;
  remark_Approval1: string;
  remark_Approval2: string;
  remark_Approval3: string;
  remark_Approval4: string;
  remark_Approval5: string;
  remark_Approval6: string;
  remark_Approval7: string;
  datetime_Approval1: string;
  datetime_Approval2: string;
  datetime_Approval3: string;
  datetime_Approval4: string;
  datetime_Approval5: string;
  datetime_Approval6: string;
  datetime_Approval7: string;
  file_Approval1: string;
  file_Approval2: string;
  file_Approval3: string;
  file_Approval4: string;
  file_Approval5: string;
  file_Approval6: string;
  file_Approval7: string;
}

export interface PurchaseReq {
  orderType: string;
  purchasingDocument: string;
  purchasingDocumentDate: string;
  sentApprovedDatetime: string;
  createdby: string;
  createdOn: string;
  headerNote: string;
  purTotalValue: string;
  statusPR: string;
  nextApproval: string;
  app_Approve1: string | null;
  app_Approve2: string | null;
  app_Approve3: string | null;
  app_Approve4: string | null;
  app_Approve5: string | null;
  app_Approve6: string | null;
  app_Approve7: string | null;
  fullname_Approve1: string | null;
  fullname_Approve2: string | null;
  fullname_Approve3: string | null;
  fullname_Approve4: string | null;
  fullname_Approve5: string | null;
  fullname_Approve6: string | null;
  fullname_Approve7: string | null;
  remark_Approval1: string | null;
  remark_Approval2: string | null;
  remark_Approval3: string | null;
  remark_Approval4: string | null;
  remark_Approval5: string | null;
  remark_Approval6: string | null;
  remark_Approval7: string | null;
  datetime_Approval1: string | null;
  datetime_Approval2: string | null;
  datetime_Approval3: string | null;
  datetime_Approval4: string | null;
  datetime_Approval5: string | null;
  datetime_Approval6: string | null;
  datetime_Approval7: string | null;
  detail: PurDetail[] | null;
  attach: PurAttach[] | null;
  releaseStg: PurReleaseStrategy[] | null;
  status: PRApprovalStatus[] | null;
  workflow: PRWorkflowStep[] | null;
  /** ผลวิเคราะห์ AI ที่ worker เก็บไว้ล่วงหน้า (JSON string) — null = ยังไม่ได้วิเคราะห์ */
  aiResult?: string | null;
}

// base URL มาจาก lib/config.ts (สลับ test/prd ด้วย API_ENV ตัวเดียว)
export { get8BitApiBaseUrl } from '@/lib/config';

async function fetchWithTokenRefresh(
  buildRequest: (token: string) => Promise<Response>
): Promise<Response> {
  const { access_token } = await getMicrosoftOAuthToken();
  const response = await buildRequest(access_token);

  if (response.status === 401) {
    const { access_token: freshToken } = await getMicrosoftOAuthToken(true);
    return buildRequest(freshToken);
  }

  return response;
}

// Fetch a stored file's raw bytes from the 8Bit API (GET /PR/File?path=<disk path>),
// authenticated server-side. Used by the /api/pr-file proxy so the browser never sees
// the token or the real server URL. Returns the upstream Response to stream through.
export async function fetch8BitFile(filePath: string): Promise<Response> {
  const baseUrl = get8BitApiBaseUrl().replace(/\/$/, '');
  const fileRoute = (process.env.API_8BIT_PR_FILE_PATH || 'PR/File').replace(/^\/+/, '');
  const targetUrl = `${baseUrl}/${fileRoute}?path=${encodeURIComponent(filePath)}`;

  return fetchWithTokenRefresh((token) =>
    fetch(targetUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  );
}

export interface PrPrompt {
  /** the editable Business Context text (system prompt) */
  promptValue: string;
  /** OpenRouter model chosen in the Set Prompt UI (may be empty) */
  model: string;
}

/**
 * สถานะของ AI Assist ที่อ่านจากหน้า Set Prompt
 *   active   = แถว prompt เปิดใช้งาน → วิเคราะห์ได้
 *   inactive = แถว prompt ปิดอยู่ → ปิดฟีเจอร์ (worker ข้าม, หน้า PR ไม่แสดงการ์ด)
 *   unset    = ไม่ได้ตั้ง SystemID / อ่านไม่ได้ → ใช้ prompt สำรองจากไฟล์
 */
export type PrPromptState =
  | { status: 'active'; prompt: PrPrompt }
  | { status: 'inactive' }
  | { status: 'unset' };

// The AI-assist prompt is authored in begeworkflow's "Set Prompt" (Business Context)
// screen and stored against a System, so it can be changed without a deploy.
// Cached briefly so a worker batch doesn't re-fetch it for every PR.
let cachedPrompt: { value: PrPromptState; expiresAt: number } | null = null;
const PROMPT_TTL_MS = 5 * 60_000;

function readStr(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/** ค่าที่ถือว่า "ปิดใช้งาน" ในคอลัมน์ Status ของแถว prompt */
function isInactiveStatus(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s === 'inactive' || s === 'n' || s === '0' || s === 'false';
}

/**
 * แปลง payload ของ getPermission เป็นสถานะ AI Assist
 * แยกไว้เป็นฟังก์ชันล้วน ๆ เพื่อให้เทสต์ได้โดยไม่ต้องยิง API
 */
export function resolvePromptState(
  payload: Record<string, unknown> | null,
  wantType: string
): PrPromptState {
  // 8Bit คืน system record พร้อม list ของ prompt (ตัวพิมพ์ใหญ่/เล็กไม่แน่นอน)
  const rowsRaw =
    (payload?.prompt as unknown) ?? (payload?.Prompt as unknown) ?? (payload?.prompts as unknown);
  const rows = Array.isArray(rowsRaw) ? (rowsRaw as Record<string, unknown>[]) : [];

  const want = wantType.trim().toLowerCase();
  const match = rows.find(
    (row) => readStr(row, ['promptType', 'PromptType']).toLowerCase() === want
  );

  if (!match) return { status: 'unset' };

  // แถวมีอยู่แต่ถูกปิด = ปิดฟีเจอร์ (ไม่ใช่ตกไปใช้ prompt สำรอง)
  if (isInactiveStatus(readStr(match, ['status', 'Status']))) return { status: 'inactive' };

  const promptValue = readStr(match, ['promptValue', 'PromptValue']);
  if (!promptValue) return { status: 'unset' };

  return {
    status: 'active',
    prompt: {
      promptValue,
      model: readStr(match, ['promptModel', 'PromptModel', 'model', 'Model']),
    },
  };
}

/**
 * อ่านสถานะ/เนื้อหา prompt "AI Assist" ของ System ที่ตั้งไว้ จาก 8Bit
 * (Permission/getPermission) — ใช้ Status ของแถวเป็นสวิตช์เปิด/ปิดฟีเจอร์
 */
export async function fetch8BitPromptState(forceRefresh = false): Promise<PrPromptState> {
  const systemID = process.env.PR_AI_ASSIST_SYSTEM_ID?.trim();
  if (!systemID) return { status: 'unset' };

  const now = Date.now();
  if (!forceRefresh && cachedPrompt && cachedPrompt.expiresAt > now) {
    return cachedPrompt.value;
  }

  const wantType = process.env.PR_AI_ASSIST_PROMPT_TYPE || 'AI Assist';
  const baseUrl = get8BitApiBaseUrl().replace(/\/$/, '');

  try {
    const response = await fetchWithTokenRefresh((token) =>
      fetch(`${baseUrl}/Permission/getPermission`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ systemID }),
        cache: 'no-store',
      })
    );
    if (!response.ok) return { status: 'unset' };

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    const state = resolvePromptState(payload, wantType);

    cachedPrompt = { value: state, expiresAt: now + PROMPT_TTL_MS };
    return state;
  } catch {
    return { status: 'unset' };
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   AI Assist — pre-compute worker endpoints (8Bit: PR/AiPending, PR/AiResult)
   ───────────────────────────────────────────────────────────────────────────── */

export interface AiPendingHeader {
  processInstanceId: string;
  purchasingDocument: string;
  headerNote: string;
  purTotalValue: string;
}

export interface AiPendingItem {
  processInstanceId: string;
  itemNo?: number;
  material?: string;
  shortText?: string;
  quantity?: string;
  unit?: string;
  requisitioner?: string;
  costCenter?: string;
  valuationPrice?: string;
  totalValue?: string;
  itemText?: string;
  itemNote?: string;
}

export interface AiResultPayload {
  ProcessInstanceId: string;
  PurchasingDocument: string;
  ResultJson: string;
  AiDecision: string;
  AiLevel: string;
  AiModel: string;
  PromptSource: string;
  AiStatus: 'SUCCESS' | 'FAILED';
  /** ส่ง '' เมื่อไม่มี error — 8Bit (.NET) ตีความ string ที่ไม่ใช่ string? ว่า required จึงส่ง null ไม่ได้ */
  AiErrorMessage: string;
}

/** 8Bit serialises some endpoints camelCase and some PascalCase — read both. */
function pick<T>(row: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key] as T;
  }
  return undefined;
}

function normalizeHeader(row: Record<string, unknown>): AiPendingHeader {
  return {
    processInstanceId: String(pick<string>(row, 'processInstanceId', 'ProcessInstanceId') ?? ''),
    purchasingDocument: String(pick<string>(row, 'purchasingDocument', 'PurchasingDocument') ?? ''),
    headerNote: String(pick<string>(row, 'headerNote', 'HeaderNote') ?? ''),
    purTotalValue: String(pick<string>(row, 'purTotalValue', 'PurTotalValue') ?? ''),
  };
}

function normalizeItem(row: Record<string, unknown>): AiPendingItem {
  const s = (...keys: string[]) => {
    const v = pick<unknown>(row, ...keys);
    return v === undefined ? '' : String(v);
  };
  return {
    processInstanceId: s('processInstanceId', 'ProcessInstanceId'),
    itemNo: Number(pick<number>(row, 'itemNo', 'ItemNo') ?? 0),
    material: s('material', 'Material'),
    shortText: s('shortText', 'ShortText'),
    quantity: s('quantity', 'Quantity'),
    unit: s('unit', 'Unit'),
    requisitioner: s('requisitioner', 'Requisitioner'),
    costCenter: s('costCenter', 'CostCenter'),
    valuationPrice: s('valuationPrice', 'ValuationPrice'),
    totalValue: s('totalValue', 'TotalValue'),
    itemText: s('itemText', 'ItemText'),
    itemNote: s('itemNote', 'ItemNote'),
  };
}

/** PR ที่สร้าง flow แล้วแต่ยังไม่มีผล AI (8Bit: POST /PR/AiPending) */
export async function fetch8BitAiPending(
  top = 5
): Promise<{ headers: AiPendingHeader[]; items: AiPendingItem[] }> {
  const baseUrl = get8BitApiBaseUrl().replace(/\/$/, '');

  const response = await fetchWithTokenRefresh((token) =>
    fetch(`${baseUrl}/PR/AiPending`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ Top: top }),
      cache: 'no-store',
    })
  );

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message.trim() || `AiPending ${response.status} ${response.statusText}`.trim());
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const rawHeaders = pick<unknown[]>(payload ?? {}, 'data', 'Data') ?? [];
  const rawItems = pick<unknown[]>(payload ?? {}, 'detail', 'Detail') ?? [];

  return {
    headers: (Array.isArray(rawHeaders) ? rawHeaders : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map(normalizeHeader)
      .filter((h) => h.processInstanceId),
    items: (Array.isArray(rawItems) ? rawItems : [])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map(normalizeItem),
  };
}

/** บันทึกผลวิเคราะห์ลง WF_PRAIResult (8Bit: POST /PR/AiResult) */
export async function submit8BitAiResult(payload: AiResultPayload): Promise<void> {
  const baseUrl = get8BitApiBaseUrl().replace(/\/$/, '');

  const response = await fetchWithTokenRefresh((token) =>
    fetch(`${baseUrl}/PR/AiResult`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
  );

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message.trim() || `AiResult ${response.status} ${response.statusText}`.trim());
  }
}

/** คะแนนรายมุมของผู้อนุมัติ 1 คน — Entry เก็บลง ResultJson.$.humanScores (รูปร่างฝั่ง Node เป็นเจ้าของ) */
export interface AiHumanScorePayload {
  ProcessInstanceId: string;
  /** ชั้นอนุมัติ — 8Bit ใช้กันซ้ำ (idempotent by level) */
  Level: number;
  Entry: {
    level: number;
    by: string;
    at: string;
    action: string;
    dims: { key: string; score: number | null; reason: string }[];
  };
}

/** บันทึกคะแนนผู้อนุมัติลง $.humanScores (8Bit: POST /PR/AiHumanScore) */
export async function submit8BitAiHumanScore(payload: AiHumanScorePayload): Promise<void> {
  const baseUrl = get8BitApiBaseUrl().replace(/\/$/, '');

  const response = await fetchWithTokenRefresh((token) =>
    fetch(`${baseUrl}/PR/AiHumanScore`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
  );

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(message.trim() || `AiHumanScore ${response.status} ${response.statusText}`.trim());
  }
}

export async function fetch8BitPRApprove(processInstanceId: string): Promise<PurchaseReq> {
  const baseUrl = get8BitApiBaseUrl().replace(/\/$/, '');
  const targetUrl = `${baseUrl}/PR/PRApprove`;

  const response = await fetchWithTokenRefresh((token) =>
    fetch(targetUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ processInstanceId }),
      cache: 'no-store',
    })
  );

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(
      message.trim() || `${response.status} ${response.statusText}`.trim()
    );
  }

  return (await response.json()) as PurchaseReq;
}

export interface PRWorkflowStep {
  releaseSeq: string;
  userName?: string;
  fullname?: string;
  statusflow: string;
  statusApprove?: string | null;
  dateApprove?: string | null;
}

export async function fetch8BitPRWorkFlow(processInstanceId: string): Promise<PRWorkflowStep[]> {
  try {
    const baseUrl = get8BitApiBaseUrl().replace(/\/$/, '');
    const response = await fetchWithTokenRefresh((token) =>
      fetch(`${baseUrl}/PR/PRWorkFlow`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ processInstanceId }),
        cache: 'no-store',
      })
    );
    if (!response.ok) return [];
    return (await response.json()) as PRWorkflowStep[];
  } catch {
    return [];
  }
}

export type PRActionType = 'APPROVE' | 'REJECT';

export interface PRSubmitPayload {
  taskID: string;
  processInstanceId: string;
  purchasingDocument: string;
  resultApprove: string;
  fullnameApprove: string;
  remarkApprove: string;
  datetimeApprove: string;
  files?: File[];
}

export interface PRSubmitResult {
  isSuccess: boolean;
  message?: string;
  statusCode?: number | string;
}

export async function submitPRSubmit(payload: PRSubmitPayload): Promise<PRSubmitResult> {
  const baseUrl = get8BitApiBaseUrl().replace(/\/$/, '');
  const actionPath = (process.env.API_8BIT_PR_SUBMIT_PATH || 'PR/PRSubmit').replace(/^\/+/, '');
  const targetUrl = `${baseUrl}/${actionPath}`;

  // 8Bit PRSubmit expects multipart/form-data ([FromForm] PurSubmit).
  // Field names match the C# model props (case-insensitive); files go under "Files".
  const buildForm = () => {
    const form = new FormData();
    form.set('TaskID', payload.taskID);
    form.set('ProcessInstanceId', payload.processInstanceId);
    form.set('PurchasingDocument', payload.purchasingDocument);
    form.set('ResultApprove', payload.resultApprove);
    form.set('FullnameApprove', payload.fullnameApprove);
    form.set('RemarkApprove', payload.remarkApprove);
    form.set('DatetimeApprove', payload.datetimeApprove);

    const files = payload.files ?? [];
    // FileName/FilePath: comma-joined so multiple files are represented. The 8Bit API
    // overwrites these from the saved files when Files are present; sending them keeps
    // the form complete (and covers the no-file case).
    const joinedNames = files.map((file) => file.name).join(',');
    form.set('FileName', joinedNames);
    form.set('FilePath', joinedNames);

    // Multiple files → one "Files" part per file (binds to List<IFormFile> Files).
    for (const file of files) {
      form.append('Files', file, file.name);
    }
    return form;
  };

  const response = await fetchWithTokenRefresh((token) =>
    fetch(targetUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        // No Content-Type: fetch sets multipart/form-data with the correct boundary.
        Authorization: `Bearer ${token}`,
      },
      body: buildForm(),
      cache: 'no-store',
    })
  );

  // Read the raw body first so we can surface the real backend message regardless of shape
  // (8Bit errors are PascalCase { StatusCode, IsSuccess, ErrorMessage }; ASP.NET validation
  // errors use { title, errors }; some responses may be plain text).
  const bodyText = await response.text().catch(() => '');
  let raw:
    | {
        StatusCode?: number | string;
        statusCode?: number | string;
        IsSuccess?: boolean;
        isSuccess?: boolean;
        Message?: string;
        message?: string;
        ErrorMessage?: string;
        errorMessage?: string;
        title?: string;
        errors?: unknown;
      }
    | null = null;
  try {
    raw = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    raw = null;
  }

  const rawStatusCode = raw?.statusCode ?? raw?.StatusCode;
  const normalizedStatusCode =
    typeof rawStatusCode === 'string' ? Number(rawStatusCode) : rawStatusCode;
  const successFlag = raw?.isSuccess ?? raw?.IsSuccess;
  const message =
    raw?.message ??
    raw?.Message ??
    raw?.errorMessage ??
    raw?.ErrorMessage ??
    (raw?.errors ? `${raw?.title ?? 'Validation error'}: ${JSON.stringify(raw.errors)}` : undefined);

  const isError =
    !response.ok ||
    (normalizedStatusCode !== undefined && normalizedStatusCode >= 400) ||
    successFlag === false;

  if (isError) {
    const detail =
      message ||
      (bodyText ? bodyText.slice(0, 400) : '') ||
      `${normalizedStatusCode ?? response.status} ${response.statusText}`;
    throw new Error(detail.trim());
  }

  return {
    isSuccess: successFlag ?? true,
    message,
    statusCode: rawStatusCode,
  };
}
