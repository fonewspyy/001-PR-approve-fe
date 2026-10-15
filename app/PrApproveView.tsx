"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { PRActionType, PRSubmitPayload, PRWorkflowStep, PurAttach, PurReleaseStrategy, PurchaseReq } from "@/lib/api/api8bit";
import { AI_DIMENSIONS, parseResultJson, type AiAssist } from "@/lib/ai/prAssist";
import { emptyHumanDims, submitHumanScore, type HumanDimInput } from "@/lib/ai/humanScore";

function FileItem({ attachment }: { attachment: PurAttach }) {
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const createdBy = text(attachment.createdbySAP);
  const createdOn = text(attachment.createdOnSAP);
  const hasInfo = createdBy || createdOn;

  function handleMouseEnter() {
    if (!hasInfo || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setPos({ top: r.top - 10, left: r.left + r.width / 2 });
  }

  function handleMouseLeave() {
    setPos(null);
  }

  return (
    <>
      <a
        ref={anchorRef}
        href={resolveFileHref(text(attachment.filePath))}
        target="_blank"
        rel="noreferrer"
        className="pr-wire-file-item"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <svg className="pr-wire-file-item-icon" xmlns="http://www.w3.org/2000/svg" width="44" height="52" viewBox="0 0 44 52" aria-hidden="true">
          {/* Page body */}
          <rect x="1" y="1" width="34" height="44" rx="3" fill="#fff" stroke="#e4e8f5" strokeWidth="1.5" />
          {/* Fold corner overlay */}
          <path d="M26 1 L35 10 L26 10 Z" fill="#e4e8f5" />
          {/* Red PDF badge */}
          <rect x="0" y="29" width="30" height="14" rx="2" fill="#e53935" />
          {/* P */}
          <path d="M4 38.5V32h3c1.4 0 2.2.9 2.2 2.1 0 1.3-.8 2.1-2.2 2.1H5.5v2.3H4zm1.5-3.5h1.2c.6 0 .9-.3.9-.8 0-.5-.3-.8-.9-.8H5.5v1.6z" fill="#fff" />
          {/* D */}
          <path d="M10.5 38.5V32h2.8c2 0 3.2 1.3 3.2 3.2 0 1.9-1.2 3.3-3.2 3.3h-2.8zm1.5-1.2h1.2c1.1 0 1.8-.8 1.8-2.1 0-1.2-.7-2-1.8-2H12v4.1z" fill="#fff" />
          {/* F */}
          <path d="M18 38.5V32h4v1.3h-2.5v1.5h2.2v1.2h-2.2v2.5H18z" fill="#fff" />
        </svg>
        <div className="pr-wire-file-body">
          <span className="pr-wire-file-name">{text(attachment.title) || "File Name"}</span>
        </div>
      </a>

      {hasInfo && pos && createPortal(
        <div
          className="pr-wire-file-popover"
          style={{ top: pos.top, left: pos.left }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="pr-wire-file-popover-arrow" />
          {createdBy && (
            <div className="pr-wire-file-tooltip-row">
              <span className="pr-wire-file-tooltip-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                </svg>
              </span>
              <span className="pr-wire-file-tooltip-label">Created by</span>
              <span className="pr-wire-file-tooltip-value">{createdBy}</span>
            </div>
          )}
          {createdOn && (
            <div className="pr-wire-file-tooltip-row">
              <span className="pr-wire-file-tooltip-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </span>
              <span className="pr-wire-file-tooltip-label">Created on</span>
              <span className="pr-wire-file-tooltip-value">{createdOn}</span>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

type Field = {
  label: string;
  value: string;
  icon?: React.ReactNode;
};

type StepStatus = "completed" | "inprogress" | "locked" | "rejected";

interface StepperData {
  seq: string;
  description: string;
  approver: string;
  datetime: string;
  status: StepStatus;
  remark: string;
  file: string;
}

const STEP_LABELS: Record<StepStatus, string> = {
  completed: "Complete",
  inprogress: "Pending",
  locked: "Waiting",
  rejected: "Reject",
};

function resolveStepStatus(
  approvalRecord: string,
  statusflow: string,
  pendingSeen: boolean
): StepStatus {
  // app_Approve field is authoritative โ€” updated immediately after action
  const approval = approvalRecord.trim().replace(/\d+$/, "").toLowerCase();
  if (/^approve/.test(approval)) return "completed";
  if (/^reject/.test(approval)) return "rejected";

  // Workflow engine status as secondary signal
  const flow = statusflow.trim().toUpperCase();
  if (["APPROVED", "COMPLETED", "COMPLETE"].includes(flow)) return "completed";
  if (["REJECTED", "REJECT"].includes(flow)) return "rejected";
  if (["PENDING", "ACTIVE", "IN_PROCESS", "INPROGRESS", "IN_PROGRESS"].includes(flow)) return "inprogress";

  // Position-based fallback: first unknown step is current, rest are locked
  if (!pendingSeen) return "inprogress";
  return "locked";
}

function buildStepperData(
  workflowSteps: PRWorkflowStep[],
  releaseStg: PurReleaseStrategy[],
  approvalRecord: Record<string, string | null | undefined>
): StepperData[] {
  const releaseMap = new Map(releaseStg.map((s) => [s.releaseSeq, s]));
  let pendingSeen = false;

  return workflowSteps.map((wfStep, i) => {
    const level = parseInt(wfStep.releaseSeq, 10) || i + 1;
    const relStep = releaseMap.get(wfStep.releaseSeq);
    const appApproval = text(approvalRecord[`app_Approve${level}`]);
    const rawStatusflow = wfStep.statusflow ?? relStep?.status ?? "";
    const status = resolveStepStatus(appApproval, rawStatusflow, pendingSeen);
    if (status === "inprogress") pendingSeen = true;

    return {
      seq: wfStep.releaseSeq || String(level),
      description: relStep?.description || `Level ${level}`,
      approver:
        text(wfStep.fullname) ||
        text(approvalRecord[`fullname_Approve${level}`]) ||
        relStep?.processor ||
        relStep?.userName ||
        "",
      datetime:
        text(wfStep.dateApprove) ||
        text(approvalRecord[`datetime_Approval${level}`]),
      status,
      remark: text(approvalRecord[`remark_Approval${level}`]),
      file: text(approvalRecord[`file_Approval${level}`]),
    };
  });
}

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "completed") {
    return (
      <div className="stepper-icon stepper-icon-completed" aria-label="Completed">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 13l4 4L19 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (status === "inprogress") {
    return (
      <div className="stepper-icon stepper-icon-inprogress" aria-label="In progress">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="#fff" strokeWidth="2" />
          <path d="M12 7.5V12l2.5 2.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  if (status === "rejected") {
    return (
      <div className="stepper-icon stepper-icon-rejected" aria-label="Rejected">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  return (
    <div className="stepper-icon stepper-icon-locked" aria-label="Locked">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="5" y="11" width="14" height="10" rx="2" stroke="#9aa4b7" strokeWidth="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="#9aa4b7" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function ApprovalStepper({ steps }: { steps: StepperData[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="stepper-card">
      <div className="stepper-track">
        {steps.map((step, index) => {
          const isFirst = index === 0;
          const isLast = index === steps.length - 1;
          const prevDone = index > 0 && steps[index - 1].status === "completed";

          return (
            <div key={step.seq} className="stepper-step">
              <div className="stepper-node">
                <div
                  className={
                    isFirst
                      ? "stepper-line stepper-line-edge"
                      : prevDone
                        ? "stepper-line stepper-line-done"
                        : "stepper-line"
                  }
                />
                <div className="stepper-icon-slot">
                  <div className={`stepper-status-top stepper-status-top-${step.status}`}>
                    {STEP_LABELS[step.status]}
                  </div>
                  <StepIcon status={step.status} />
                </div>
                <div
                  className={
                    isLast
                      ? "stepper-line stepper-line-edge"
                      : step.status === "completed"
                        ? "stepper-line stepper-line-done stepper-line-right"
                        : "stepper-line stepper-line-right"
                  }
                />
              </div>

              <div className={step.status === "locked" ? "stepper-body stepper-body-locked" : "stepper-body"}>
                <div className="stepper-step-name">
                  Step {index + 1}{(step.approver || step.description) ? `: ${step.approver || step.description}` : ""}
                </div>
                {step.datetime && (step.status === "completed" || step.status === "rejected") ? (
                  <div className="stepper-datetime">{step.datetime}</div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const AFLOW_LABEL: Record<StepStatus, string> = {
  completed: "Approved",
  inprogress: "Waiting",
  locked: "Pending",
  rejected: "Rejected",
};

const AFLOW_DESC: Record<StepStatus, string> = {
  completed: "Reviewed and approved",
  inprogress: "Pending your approval",
  locked: "Waiting for previous step",
  rejected: "Rejected",
};

function AFlowIcon({ status }: { status: StepStatus }) {
  if (status === "completed") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (status === "inprogress") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    );
  }
  if (status === "rejected") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3h10M7 21h10M8 3v3.6a4 4 0 0 0 8 0V3M8 21v-3.6a4 4 0 0 1 8 0V21" />
    </svg>
  );
}

function ApprovalStepperVertical({
  steps,
  canAct,
  comment,
  onCommentChange,
  submitting,
  onAction,
  attachedFiles,
  onAttachFiles,
  onRemoveFile,
}: {
  steps: StepperData[];
  canAct: boolean;
  comment: string;
  onCommentChange: (value: string) => void;
  submitting: PRActionType | null;
  onAction: (action: PRActionType) => void;
  attachedFiles: File[];
  onAttachFiles: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: (fileKey: string) => void;
}) {
  if (steps.length === 0) {
    return (
      <div className="stepper-v-empty">
        <p>No approval flow data available.</p>
      </div>
    );
  }
  return (
    <div className="aflow">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const isActive = step.status === "inprogress";
        return (
          <div
            key={step.seq}
            className={`aflow-item aflow-item-${step.status}${isActive ? " aflow-item-active" : ""}`}
          >
            <div className="aflow-rail">
              <span className={`aflow-num aflow-num-${step.status}`}>{index + 1}</span>
              {!isLast && (
                <span className={`aflow-line${step.status === "completed" ? " aflow-line-done" : ""}`} />
              )}
            </div>

            <div className="aflow-content">
              <div className="aflow-head">
                <span className={`aflow-icon aflow-icon-${step.status}`}>
                  <AFlowIcon status={step.status} />
                </span>
                <div className="aflow-titles">
                  <span className="aflow-title">Step {index + 1}</span>
                  {step.approver ? <span className="aflow-name">{step.approver}</span> : null}
                </div>
                <span className={`aflow-badge aflow-badge-${step.status}`}>{AFLOW_LABEL[step.status]}</span>
              </div>

              <p className="aflow-desc">{AFLOW_DESC[step.status]}</p>
              {step.datetime && (step.status === "completed" || step.status === "rejected") ? (
                <p className="aflow-datetime">{step.datetime}</p>
              ) : null}
              {step.remark ? (
                <p className="aflow-remark">
                  <span className="aflow-remark-label">Remark:</span> {step.remark}
                </p>
              ) : null}
              {step.file ? (
                <div className="aflow-files">{renderApprovalFiles(step.file)}</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type TabKey = "texts" | "release";

const itemColumns: Array<{
  label: string;
  value: (row: NonNullable<PurchaseReq["detail"]>[number]) => string;
  align?: "right";
}> = [
  { label: "Item", value: (r) => r.itemNo },
  { label: "Material", value: (r) => r.material },
  { label: "Short Text", value: (r) => r.shortText },
  { label: "Quantity", value: (r) => r.quantity, align: "right" },
  { label: "Unit", value: (r) => r.unit },
  { label: "Delivery Date", value: (r) => r.deliveryDate },
  { label: "Material Group", value: (r) => r.materialGroup },
  { label: "Plant", value: (r) => r.plant },
  { label: "Stor. Location", value: (r) => r.storLocation },
  { label: "Purch. Group", value: (r) => r.purchaseGroup },
  { label: "Requisitioner", value: (r) => r.requisitioner },
  { label: "AccAssCat", value: (r) => r.accAssCat },
  { label: "GL Account", value: (r) => r.gL_Account },
  { label: "Cost Center", value: (r) => r.costCenter },
  { label: "Distribution", value: (r) => r.distribution },
  { label: "CoCode", value: (r) => r.coCode },
  { label: "CreatedBySAP", value: (r) => r.createdBySAP },
  { label: "ValuationPrice", value: (r) => r.valuationPrice, align: "right" },
  { label: "TotalValue", value: (r) => r.totalValue, align: "right" },
];

function text(value: string | null | undefined) {
  return value ?? "";
}

// เวลาไทยตายตัว ไม่อิง locale/timezone ของเครื่องผู้ใช้ กันค่าที่ server กับ browser render ไม่ตรงกัน
const AI_TIME_FMT = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO จาก ResultJson.head.analyzedAt → "8 ส.ค. 2569 14:53" ("" ถ้าแถวเก่าไม่มีเวลา) */
function formatAiTime(iso: string): string {
  if (!iso) return "";

  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  // th-TH ใส่ " น." ต่อท้ายเวลาให้เอง เหลือแค่ตัดคอมมาคั่นวัน/เวลาออก
  return AI_TIME_FMT.format(at).replace(",", "");
}

function aiScoreTone(score: number): "low" | "mid" | "high" {
  if (score <= 2) return "low";
  if (score === 3) return "mid";
  return "high";
}

// Radar chart (6 axes, 1–5). Pure SVG so it needs no chart library and stays crisp.
function AiRadar({ scores }: { scores: number[] }) {
  const cx = 150;
  const cy = 148;
  const r = 96;
  const n = AI_DIMENSIONS.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const point = (i: number, v: number): [number, number] => [
    cx + ((r * v) / 5) * Math.cos(angle(i)),
    cy + ((r * v) / 5) * Math.sin(angle(i)),
  ];
  const ringPoints = (ring: number) =>
    Array.from({ length: n }, (_, i) => point(i, ring).map((v) => v.toFixed(1)).join(",")).join(" ");
  const shape = Array.from({ length: n }, (_, i) =>
    point(i, scores[i] ?? 0)
      .map((v) => v.toFixed(1))
      .join(",")
  ).join(" ");

  return (
    <svg viewBox="0 26 300 248" className="ai-radar" role="img" aria-label="สรุปคะแนน 6 มุมมองแบบเรดาร์">
      {[1, 2, 3, 4, 5].map((ring) => (
        <polygon key={ring} points={ringPoints(ring)} className="ai-radar-ring" />
      ))}
      {Array.from({ length: n }, (_, i) => {
        const [ex, ey] = point(i, 5);
        return <line key={i} x1={cx} y1={cy} x2={ex.toFixed(1)} y2={ey.toFixed(1)} className="ai-radar-spoke" />;
      })}
      <polygon points={shape} className="ai-radar-shape" />
      {/* Vertices carry the same tone colours as the score badges, so a glance at the
          chart shows which dimensions are the weak ones. */}
      {Array.from({ length: n }, (_, i) => {
        const [px, py] = point(i, scores[i] ?? 0);
        return (
          <circle
            key={i}
            cx={px.toFixed(1)}
            cy={py.toFixed(1)}
            r="4"
            className={`ai-radar-dot ai-radar-dot--${aiScoreTone(scores[i] ?? 0)}`}
          />
        );
      })}
      {AI_DIMENSIONS.map((dim, i) => {
        const [lx, ly] = point(i, 5.72);
        const anchor = lx > cx + 5 ? "start" : lx < cx - 5 ? "end" : "middle";
        return (
          <text key={dim.key} x={lx.toFixed(1)} y={(ly + 4).toFixed(1)} textAnchor={anchor} className="ai-radar-label">
            {dim.short}
          </text>
        );
      })}
    </svg>
  );
}

// Origin of the parent portal (begeworkflow) that embeds this page. postMessage is
// targeted at this origin so the messages aren't broadcast to any embedding site.
// Set NEXT_PUBLIC_WORKFLOW_ORIGIN in production (https://oi.beger.co.th:8900).
// Unset: dev uses the local Lunar origin, production stays "" and postToParent sends nothing.
// Never fall back to "*": any page that frames this app would receive the approval result.
const PARENT_ORIGIN =
  process.env.NEXT_PUBLIC_WORKFLOW_ORIGIN?.trim() ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:3100");
let warnedNoParentOrigin = false;

function postToParent(message: Record<string, unknown>) {
  if (PARENT_ORIGIN) {
    window.parent.postMessage(message, PARENT_ORIGIN);
  } else if (!warnedNoParentOrigin) {
    // The approval is still saved; only the Inbox will not refresh or react by itself.
    warnedNoParentOrigin = true;
    console.error("NEXT_PUBLIC_WORKFLOW_ORIGIN is not set: not posting messages to the WorkFlow portal");
  }
}

// Counts a formatted number up (e.g. 10,000 → 10,694) the first time it scrolls
// into view. Preserves the source formatting (commas + decimals) and respects
// prefers-reduced-motion by showing the final value immediately.
function CountUp({ raw }: { raw: string }) {
  const spanRef = useRef<HTMLSpanElement>(null);
  // Holds the in-flight animated value together with the raw it belongs to, so the
  // rendered text derives from props (no state writes during render/effect setup and
  // no stale value if `raw` changes).
  const [anim, setAnim] = useState<{ raw: string; value: string } | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!raw || raw === "-") return;
    const cleaned = raw.replace(/,/g, "");
    const target = parseFloat(cleaned);
    if (isNaN(target)) return;

    const hasCommas = raw.includes(",");
    const decMatch = cleaned.match(/\.(\d+)$/);
    const decimals = decMatch ? decMatch[1].length : 0;
    const fmt = (n: number) => {
      const fixed = n.toFixed(decimals);
      if (!hasCommas) return fixed;
      const [int, dec] = fixed.split(".");
      const intFmt = Math.floor(parseFloat(int)).toLocaleString("en-US");
      return dec !== undefined ? `${intFmt}.${dec}` : intFmt;
    };

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const el = spanRef.current;
    // Reduced motion (or no element): render `raw` as-is, already the final value.
    if (reduce || !el) return;

    started.current = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return;
        started.current = true;
        observer.disconnect();

        const duration = 1000;
        const startTime = performance.now();
        const step = (now: number) => {
          const t = Math.min((now - startTime) / duration, 1);
          const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
          setAnim({ raw, value: fmt(target * eased) });
          if (t < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [raw]);

  const display = anim && anim.raw === raw ? anim.value : raw;
  return <span ref={spanRef}>{display}</span>;
}

// "Common to all items" popover: keys shown in the accounting section (as cards / a
// plain row) vs. the general icon grid, plus Thai display labels and per-field icons.
const SHARED_ACCOUNT_KEYS = ["AccAssCat", "GL Account", "Cost Center"];
const SHARED_GENERAL_ORDER = [
  "Delivery Date",
  "Plant",
  "Material Group",
  "Purch. Group",
  "Requisitioner",
  "CreatedBySAP",
  "Stor. Location",
  "Distribution",
  "CoCode",
];
const SHARED_FIELD_TH: Record<string, string> = {
  "Delivery Date": "วันที่ส่งมอบ",
  Requisitioner: "ผู้ขอ",
  CreatedBySAP: "ผู้สร้าง",
};

// Split "CODE: description" into its parts (GL Account / Cost Center values).
function splitCodeDesc(value: string): { code: string; desc: string } {
  const idx = value.indexOf(":");
  if (idx === -1) return { code: value.trim(), desc: "" };
  return { code: value.slice(0, idx).trim(), desc: value.slice(idx + 1).trim() };
}

function SharedFieldIcon({ label }: { label: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (label) {
    case "Delivery Date":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
      );
    case "Plant":
      return (
        <svg {...common}>
          <path d="M3 21h18M4 21V10l6 4V10l6 4V6l4 2v13" />
        </svg>
      );
    case "Material Group":
      return (
        <svg {...common}>
          <path d="M21 8 12 3 3 8l9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" />
        </svg>
      );
    case "Purch. Group":
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-3-3.87M9 21v-2a4 4 0 0 1 3-3.87" />
          <circle cx="9" cy="7" r="3" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "Requisitioner":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21v-1a6 6 0 0 1 12 0v1" />
        </svg>
      );
    case "CreatedBySAP":
      return (
        <svg {...common}>
          <circle cx="10" cy="8" r="4" />
          <path d="M3 21v-1a6 6 0 0 1 11-3.3" />
          <path d="M18 13.5 20 15l2.5-3" />
        </svg>
      );
    case "GL Account":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 9h6M7 13h6M7 17h3" />
          <circle cx="17" cy="14" r="1.5" />
        </svg>
      );
    case "Cost Center":
      return (
        <svg {...common}>
          <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 8h3a2 2 0 0 1 2 2v11M4 21h18" />
          <path d="M8 7h2M8 11h2M8 15h2" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </svg>
      );
  }
}

/**
 * คัดลอกข้อความลง clipboard
 * ลอง Clipboard API ก่อน ถ้าโดนบล็อก (เช่นฝังใน iframe คนละ origin ที่ portal ไม่ให้สิทธิ์
 * clipboard-write หรือไม่ใช่ secure context) ค่อยใช้ execCommand("copy") สำรอง
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // ไปทางสำรองด้านล่าง
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

function CopyDocBadge({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const ok = await copyText(value);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      className={`pr-wire-doc-badge${copied ? " is-copied" : ""}`}
      onClick={handleCopy}
      title={copied ? "Copied" : "Copy document number"}
      aria-label={copied ? "Copied" : `Copy document number ${value}`}
    >
      {value}
    </button>
  );
}

function fileLinkLabel(url: string) {
  const name = url.split(/[?#]/)[0].split(/[\\/]/).pop() || url;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

// Files stored on the 8Bit server come back as disk paths (e.g. D:\ftpData\iPR\...).
// Route those through our /api/pr-file proxy so they open in the browser (auth handled
// server-side). Values that are already http(s) URLs are used as-is.
function resolveFileHref(value: string) {
  const v = value.trim();
  if (!v) return "#";
  if (/^https?:\/\//i.test(v)) return v;
  return `/001/api/pr-file?path=${encodeURIComponent(v)}`;
}

function renderApprovalFiles(raw: string) {
  const files = raw.split(",").map((file) => file.trim()).filter(Boolean);
  if (files.length === 0) {
    return "-";
  }
  return (
    <span className="approval-file-cell">
      {files.map((file, index) => {
        const label = fileLinkLabel(file);
        return (
          <a
            key={`${file}-${index}`}
            className="file-link"
            href={resolveFileHref(file)}
            target="_blank"
            rel="noreferrer"
            title={label}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21.44 11.05 12.25 20.24a5 5 0 0 1-7.07-7.07l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
            <span className="file-link-name">{label}</span>
          </a>
        );
      })}
    </span>
  );
}

function buildApprovalTimestamp() {
  // Local wall-clock time (e.g. Thailand ICT), NOT UTC — the backend stores the
  // clock value as-is, so toISOString() would be 7h behind for +07:00 users.
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

function getApprovalHistoryStatus(rawStatus: string) {
  const normalizedStatus = rawStatus.trim().replace(/\d+$/, "");

  if (!normalizedStatus) {
    return null;
  }

  if (/^reject(ed)?$/i.test(normalizedStatus)) {
    return {
      label: normalizedStatus,
      className: "status-pill status-pill-reject",
    };
  }

  if (/^approve(d)?$/i.test(normalizedStatus)) {
    return {
      label: normalizedStatus,
      className: "status-pill status-pill-approve",
    };
  }

  return {
    label: normalizedStatus,
    className: "status-pill",
  };
}

function FieldColumn({ fields }: { fields: Field[] }) {
  return (
    <div className="purchase-column">
      {fields.map((field) => (
        <div key={field.label} className="field-row">
          <label>{field.label}</label>
          <div className="value-box">{field.value}</div>
        </div>
      ))}
    </div>
  );
}

export default function PrApproveView({
  data,
  processInstanceId,
  taskId,
  username,
  fullName,
  workflowSteps,
  canAct,
}: {
  data: PurchaseReq;
  processInstanceId: string;
  taskId: string;
  username: string;
  fullName: string;
  workflowSteps: PRWorkflowStep[];
  canAct: boolean;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("texts");
  const [comment, setComment] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState<PRActionType | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [resultOverlayAction, setResultOverlayAction] = useState<PRActionType | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerClosing, setDrawerClosing] = useState(false);
  // The "common to all items" panel expands inline (in the card) via the header button.
  const [sharedInfoOpen, setSharedInfoOpen] = useState(false);
  // AI Assist: the market-price sources panel expands from the "ราคาเทียบตลาด" row.
  const [aiPriceOpen, setAiPriceOpen] = useState(false);
  // AI Assist result. ปกติ worker วิเคราะห์ไว้ล่วงหน้าแล้ว และ GET_DATA ส่ง aiResult
  // มาด้วย → แสดงได้ทันทีโดยไม่ต้องเรียก OpenRouter. ถ้ายังไม่มีผลค่อย fallback
  // เรียกสด. ไม่มี mock/hardcoded — ล้มเหลวเมื่อไหร่การ์ดขึ้นสถานะ error
  const aiDocNo = text(data.purchasingDocument);
  const storedAi = useMemo(() => parseResultJson(data.aiResult), [data.aiResult]);
  const [aiAssist, setAiAssist] = useState<AiAssist | null>(storedAi);
  const [aiLoading, setAiLoading] = useState(!storedAi);
  // ผู้ดูแลปิดฟีเจอร์ไว้ (prompt = Inactive) → ซ่อนการ์ดทั้งใบ
  const [aiDisabled, setAiDisabled] = useState(false);
  // คะแนนรายมุมที่ผู้อนุมัติให้เอง (เทียบ AI) — ไม่บังคับกรอก ส่งตอนกดอนุมัติ (best-effort)
  const [humanDims, setHumanDims] = useState<HumanDimInput>(emptyHumanDims);
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const drawerBodyRef = useRef<HTMLDivElement | null>(null);
  const canGoPrev = activeTab === "release";
  const canGoNext = activeTab === "texts";

  // Notify the parent portal (begeworkflow) about form scrolling so it can collapse/expand the top bar.
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) {
      return;
    }

    let lastScrollTop = window.scrollY;

    const handleScroll = () => {
      const scrollTop = window.scrollY;
      postToParent({ type: "pr-scroll", scrollTop, delta: scrollTop - lastScrollTop });
      lastScrollTop = scrollTop;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Tell the parent portal (begeworkflow) when the Approval Flow drawer opens/closes,
  // so it can shrink the inbox rail and give the PR workspace more room.
  useEffect(() => {
    if (typeof window === "undefined" || window.parent === window) return;
    postToParent({ type: "pr-drawer", open: drawerOpen });
  }, [drawerOpen]);

  // ใบนี้ยังไม่มีผลที่เก็บไว้ (worker ยังไม่ถึงคิว) → เรียกสดให้ผู้อนุมัติไม่ต้องรอรอบถัดไป
  // route จะบันทึกผลกลับเข้า DB ให้เอง ครั้งต่อไปเปิดจึงเห็นทันที
  useEffect(() => {
    if (storedAi) {
      setAiAssist(storedAi);
      setAiLoading(false);
      return;
    }

    let cancelled = false;
    setAiLoading(true);
    setAiAssist(null);

    fetch("/001/api/ai-assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, processInstanceId }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { aiAssist?: AiAssist; disabled?: boolean }) => {
        if (cancelled) return;
        if (json?.disabled) setAiDisabled(true);
        else if (json?.aiAssist) setAiAssist(json.aiAssist);
      })
      .catch(() => {
        /* การ์ดจะขึ้นสถานะ "วิเคราะห์ไม่สำเร็จ" */
      })
      .finally(() => {
        if (!cancelled) setAiLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiDocNo, storedAi]);

  // Sync the drawer content scroll with the PR page scroll: scrolling the PR to the
  // bottom scrolls the Approval Flow drawer to the bottom too.
  useEffect(() => {
    if (!drawerOpen) return;
    const body = drawerBodyRef.current;
    if (!body) return;

    const syncScroll = () => {
      const pageScrollable = document.documentElement.scrollHeight - window.innerHeight;
      const drawerScrollable = body.scrollHeight - body.clientHeight;
      if (pageScrollable <= 0 || drawerScrollable <= 0) return;
      const fraction = Math.min(1, Math.max(0, window.scrollY / pageScrollable));
      body.scrollTop = fraction * drawerScrollable;
    };

    syncScroll();
    window.addEventListener("scroll", syncScroll, { passive: true });
    return () => window.removeEventListener("scroll", syncScroll);
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setDrawerClosing(true);
      window.setTimeout(() => {
        setDrawerOpen(false);
        setDrawerClosing(false);
      }, 260);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  function openDrawer() {
    setDrawerOpen(true);
    setDrawerClosing(false);
  }

  function closeDrawer() {
    setDrawerClosing(true);
    window.setTimeout(() => {
      setDrawerOpen(false);
      setDrawerClosing(false);
    }, 260);
  }

  function handleAttachFiles(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? []);
    if (nextFiles.length === 0) {
      return;
    }

    setAttachedFiles((currentFiles) => {
      const fileMap = new Map(
        currentFiles.map((file) => [`${file.name}-${file.size}-${file.lastModified}`, file])
      );

      for (const file of nextFiles) {
        fileMap.set(`${file.name}-${file.size}-${file.lastModified}`, file);
      }

      return Array.from(fileMap.values());
    });

    event.target.value = "";
  }

  function handleRemoveFile(fileKey: string) {
    setAttachedFiles((currentFiles) =>
      currentFiles.filter((file) => `${file.name}-${file.size}-${file.lastModified}` !== fileKey)
    );
  }

  function buildSubmitPayload(action: PRActionType, commentText: string): PRSubmitPayload {
    return {
      taskID: taskId,
      processInstanceId,
      purchasingDocument: text(data.purchasingDocument),
      resultApprove: action === "REJECT" ? "Reject" : "Approve",
      fullnameApprove: fullName,
      remarkApprove: commentText.trim(),
      datetimeApprove: buildApprovalTimestamp(),
    };
  }

  function notifyParent(result: { ok: boolean; action: PRActionType; message?: string }) {
    if (typeof window !== "undefined" && window.parent !== window) {
      postToParent({ type: "pr-action-result", ...result });
    }
  }

  async function handleAction(action: PRActionType, options?: { comment?: string }) {
    if (submitting) {
      return;
    }

    const effectiveComment = (options?.comment ?? comment).trim();

    if (!username) {
      const message = "No approver. Open this page from the inbox so the user is provided.";
      setFeedback({ tone: "error", message });
      notifyParent({ ok: false, action, message });
      return;
    }

    if (action === "REJECT" && !effectiveComment) {
      const message = "Please enter a comment before rejecting.";
      setFeedback({ tone: "error", message });
      notifyParent({ ok: false, action, message });
      return;
    }

    setSubmitting(action);
    setFeedback(null);

    // (best-effort) บันทึกคะแนนรายมุมของผู้อนุมัติก่อน แล้วค่อยส่งอนุมัติ — พังก็ไม่บล็อก
    if (canAct) {
      await submitHumanScore({
        processInstanceId,
        level: currentApproverLevel,
        by: fullName,
        action: action === "REJECT" ? "REJECT" : "APPROVE",
        dims: humanDims,
      });
    }

    try {
      const payload = buildSubmitPayload(action, effectiveComment);
      const formData = new FormData();
      formData.set("taskID", payload.taskID);
      formData.set("processInstanceId", payload.processInstanceId);
      formData.set("purchasingDocument", payload.purchasingDocument);
      formData.set("resultApprove", payload.resultApprove);
      formData.set("fullnameApprove", payload.fullnameApprove);
      formData.set("remarkApprove", payload.remarkApprove);
      formData.set("datetimeApprove", payload.datetimeApprove);
      for (const file of attachedFiles) {
        formData.append("files", file);
      }

      const response = await fetch("/001/api/pr-action", {
        method: "POST",
        body: formData,
      });

      const result = (await response.json().catch(() => null)) as {
        message?: string;
        isSuccess?: boolean;
        statusCode?: number | string;
      } | null;
      const normalizedStatusCode =
        typeof result?.statusCode === "string" ? Number(result.statusCode) : result?.statusCode;

      if (!response.ok || result?.isSuccess === false || (normalizedStatusCode !== undefined && normalizedStatusCode >= 400)) {
        throw new Error(result?.message || `${response.status} ${response.statusText}`.trim());
      }

      const successMessage = result?.message || (action === "REJECT" ? "Rejected successfully." : "Approved successfully.");

      setComment("");
      setAttachedFiles([]);
      if (attachInputRef.current) {
        attachInputRef.current.value = "";
      }

      if (action === "APPROVE") {
        setResultOverlayAction("APPROVE");
        window.setTimeout(() => {
          setResultOverlayAction(null);
          notifyParent({ ok: true, action, message: successMessage });
          router.refresh();
        }, 2000);
      } else {
        setResultOverlayAction("REJECT");
        window.setTimeout(() => {
          setResultOverlayAction(null);
          notifyParent({ ok: true, action, message: successMessage });
          router.refresh();
        }, 2000);
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to submit. Please try again.";
      setFeedback({ tone: "error", message });
      notifyParent({ ok: false, action, message });
    } finally {
      setSubmitting(null);
    }
  }

  const detail = data.detail ?? [];
  const attachments = data.attach ?? [];
  const releaseSteps = data.releaseStg ?? [];

  // Table Item redesign: most line-item columns repeat the same value on every row
  // (plant, GL account, cost center, delivery date…). Pull those out into a single
  // "common to all items" block and let each item row show only what actually differs
  // (identity + amounts + any per-item fields), instead of a 19-column horizontal scroll.
  const itemRowKeys = new Set([
    "Item",
    "Short Text",
    "Material",
    "Quantity",
    "Unit",
    "ValuationPrice",
    "TotalValue",
  ]);
  const detailColumns = itemColumns.filter((column) => !itemRowKeys.has(column.label));
  const sharedColumns = detail.length
    ? detailColumns.filter((column) => {
        const first = text(column.value(detail[0]));
        return first !== "" && detail.every((row) => text(column.value(row)) === first);
      })
    : [];
  const sharedKeys = new Set(sharedColumns.map((column) => column.label));
  const varyingColumns = detailColumns.filter(
    (column) =>
      !sharedKeys.has(column.label) && detail.some((row) => text(column.value(row)) !== "")
  );
  const showUnitPrice = detail.some((row) => text(row.valuationPrice) !== "");
  const showTotal = detail.some((row) => text(row.totalValue) !== "");

  // Split shared fields for the rich "common to all items" popover: an icon grid of
  // general fields + a dedicated accounting section (GL Account / Cost Center cards).
  const sharedGeneral = sharedColumns
    .filter((column) => !SHARED_ACCOUNT_KEYS.includes(column.label))
    .sort((a, b) => {
      const ia = SHARED_GENERAL_ORDER.indexOf(a.label);
      const ib = SHARED_GENERAL_ORDER.indexOf(b.label);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  const sharedAccValue = (label: string) => {
    const column = sharedColumns.find((c) => c.label === label);
    return column ? text(column.value(detail[0])) : "";
  };
  const glAccount = sharedAccValue("GL Account");
  const costCenter = sharedAccValue("Cost Center");

  const approvalRecord = (data.status?.[0] ?? data) as unknown as Record<
    string,
    string | null | undefined
  >;

  const stepperSteps = buildStepperData(workflowSteps, releaseSteps, approvalRecord);
  // ชั้นอนุมัติปัจจุบัน = step ที่กำลัง inprogress (นิยามเดียวกับ stepper) ใช้เป็นคีย์เก็บคะแนนคน
  const currentApproverLevel = Number(stepperSteps.find((s) => s.status === "inprogress")?.seq) || 0;
  const approvalHistory = Array.from({ length: 7 }, (_, index) => {
    const level = index + 1;
    return {
      level,
      approver: text(approvalRecord[`app_Approve${level}`]),
      fullname: text(approvalRecord[`fullname_Approve${level}`]),
      remark: text(approvalRecord[`remark_Approval${level}`]),
      datetime: text(approvalRecord[`datetime_Approval${level}`]),
      file: text(approvalRecord[`file_Approval${level}`]),
    };
  }).filter((row) => row.approver || row.fullname || row.remark || row.datetime || row.file);

  const purchaseFieldsLeft: Field[] = [
    { label: "Purchasing Document", value: text(data.purchasingDocument) },
    {
      label: "Order Type",
      value: text(data.orderType),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/>
        </svg>
      ),
    },
    {
      label: "Doc. Date",
      value: text(data.purchasingDocumentDate),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      ),
    },
  ];

  const purchaseFieldsRight: Field[] = [
    {
      label: "Created by",
      value: text(data.createdby),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
      ),
    },
    {
      label: "Created On",
      value: text(data.createdOn),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ),
    },
    {
      label: "วันที่ส่งอนุมัติจาก SAP",
      value: text(data.sentApprovedDatetime),
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      ),
    },
  ];

  return (
    <>
      {resultOverlayAction ? (
        <div className="approve-success-overlay">
          <img
            src={resultOverlayAction === "REJECT" ? "/001/reject.svg" : "/001/success.svg"}
            alt={resultOverlayAction === "REJECT" ? "Rejected" : "Approved"}
            className="approve-success-icon"
          />
          <p
            className={
              resultOverlayAction === "REJECT"
                ? "approve-reject-text"
                : "approve-success-text"
            }
          >
            {resultOverlayAction === "REJECT" ? "Rejected successfully." : "Approved successfully."}
          </p>
        </div>
      ) : null}

      {/* Drawer trigger tab - left side */}
      <button
        type="button"
        className="approval-drawer-trigger"
        onClick={openDrawer}
        aria-label="Approval Flow"
      >
        <span className="adtrig-ping" aria-hidden="true">
          <span className="adtrig-ping-ring" />
          <span className="adtrig-ping-dot" />
        </span>
        <svg className="adtrig-icon adtrig-pulse" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
          <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" strokeWidth="2" />
          <path d="M14 9l3 3-3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="adtrig-label">Approval Flow</span>
        <svg className="adtrig-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Drawer overlay + panel */}
      {drawerOpen && (
        <>
          <div
            className={`approval-drawer${drawerClosing ? " approval-drawer-out" : ""}`}
            role="dialog"
            aria-modal="false"
            aria-label="Approval Flow"
          >
            <div className="approval-drawer-header">
              <div className="approval-drawer-header-center">
                <div className="approval-drawer-header-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <circle cx="6" cy="6" r="2.4" stroke="currentColor" strokeWidth="2" />
                    <circle cx="6" cy="18" r="2.4" stroke="currentColor" strokeWidth="2" />
                    <circle cx="18" cy="12" r="2.4" stroke="currentColor" strokeWidth="2" />
                    <path d="M8.4 6H13a3 3 0 0 1 3 3v.8M8.4 18H13a3 3 0 0 0 3-3v-.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
                <div>
                  <h3 className="approval-drawer-title">Approval Flow</h3>
                </div>
              </div>
              <button
                type="button"
                className="approval-drawer-close"
                onClick={closeDrawer}
                aria-label="Close"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="approval-drawer-body" ref={drawerBodyRef}>
              <ApprovalStepperVertical
                steps={stepperSteps}
                canAct={canAct}
                comment={comment}
                onCommentChange={setComment}
                submitting={submitting}
                onAction={(action) => handleAction(action)}
                attachedFiles={attachedFiles}
                onAttachFiles={handleAttachFiles}
                onRemoveFile={handleRemoveFile}
              />
            </div>
          </div>
        </>
      )}

      <main className={`legacy-page pr-wire-page${drawerOpen ? " pr-wire-page-shifted" : ""}`}>
          <section className="pr-wire-doc">
            <div className="pr-wire-title-trigger">
              <div className="pr-wire-doc-head">
                <div className="pr-wire-doc-main">
                  <span className="pr-wire-title-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                      <path d="M14 3v4a1 1 0 0 0 1 1h4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <line x1="9" y1="13" x2="15" y2="13" strokeWidth="2" strokeLinecap="round" />
                      <line x1="9" y1="16.5" x2="12.5" y2="16.5" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                  <div className="pr-wire-doc-titles">
                    <div className="pr-wire-title-row">
                      <h1 className="pr-wire-title">Purchasing Document</h1>
                      {text(data.purchasingDocument) && (
                        <CopyDocBadge value={text(data.purchasingDocument)} />
                      )}
                    </div>
                    {text(data.createdOn) && (
                      <div className="pr-wire-doc-sub">Created on {text(data.createdOn)}</div>
                    )}
                  </div>
                </div>

                {text(data.createdby) && (
                  <div className="pr-wire-doc-meta">
                    <div className="pr-wire-doc-field">
                      <span className="pr-wire-doc-field-label">Requester</span>
                      <span className="pr-wire-doc-field-value">{text(data.createdby)}</span>
                    </div>
                    <span className="pr-wire-doc-avatar" aria-hidden="true">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                    </span>
                  </div>
                )}
              </div>

              <div className="pr-wire-meta-tooltip" aria-hidden="true">
                {[...purchaseFieldsLeft, ...purchaseFieldsRight]
                  .filter((f) => f.value && f.label !== "Purchasing Document")
                  .map((field) => (
                    <div key={field.label} className="pr-wire-tooltip-row">
                      <span className="pr-wire-tooltip-label">
                        {field.icon && <span className="pr-wire-tooltip-icon">{field.icon}</span>}
                        {field.label}
                      </span>
                      <span className="pr-wire-tooltip-value">{field.value}</span>
                    </div>
                  ))}
              </div>
            </div>
          </section>

          <section className="pr-wire-top-grid">
            <div className="legacy-section pr-wire-panel">
              <div className="legacy-section-title">Header note</div>
              <div className="pr-wire-panel-body">
                <div className="pr-wire-note-box">
                  {activeTab === "texts" ? text(data.headerNote) || "-" : null}
                </div>
               
                {activeTab === "release" ? (
                  <div className="release-table-wrap pr-wire-release-wrap">
                    <table className="release-table">
                      <thead>
                        <tr>
                          <th>Level</th>
                          <th>Description</th>
                          <th>Approver</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {releaseSteps.length === 0 ? (
                          <tr>
                            <td colSpan={4}>-</td>
                          </tr>
                        ) : (
                          releaseSteps.map((step, index) => (
                            <tr key={`${text(step.code)}-${index}`}>
                              <td>{text(step.releaseSeq) || text(step.code) || `Step ${index + 1}`}</td>
                              <td>{text(step.description)}</td>
                              <td>{text(step.userName) || text(step.processor)}</td>
                              <td>{text(step.status)}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="legacy-section pr-wire-panel pr-wire-file-panel">
              <div className="legacy-section-title">File</div>
              <div className="pr-wire-panel-body">
                {attachments.length === 0 ? (
                  <div className="pr-wire-file-empty">ยังไม่มีไฟล์แนบ</div>
                ) : (
                  <div className="pr-wire-file-list">
                    {attachments.map((attachment, index) => (
                      <FileItem
                        key={`${text(attachment.title)}-${index}`}
                        attachment={attachment}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="legacy-section pr-wire-panel pr-wire-item-panel">
            <div className="pr-items-header">
              <span className="pr-items-header-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 6h13M8 12h13M8 18h13" />
                  <circle cx="3.5" cy="6" r="1.2" />
                  <circle cx="3.5" cy="12" r="1.2" />
                  <circle cx="3.5" cy="18" r="1.2" />
                </svg>
              </span>
              <h2 className="pr-items-header-title">รายการสินค้าและบริการ</h2>
              <span className="pr-items-count">{detail.length} รายการ</span>
              {sharedColumns.length > 0 && (
                <button
                  type="button"
                  className="pr-items-info-btn"
                  onClick={() => setSharedInfoOpen((open) => !open)}
                  aria-controls="pr-shared-panel"
                  aria-expanded={sharedInfoOpen}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
                  </svg>
                  ข้อมูลเพิ่มเติม
                  <svg className="pr-items-info-btn-caret" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
              )}
            </div>

            {detail.length === 0 ? (
              <div className="pr-items-empty">ไม่มีรายการสินค้า</div>
            ) : (
              <div className="pr-items">
                {sharedColumns.length > 0 && (
                  <div
                    id="pr-shared-panel"
                    className={`pr-shared-inline${sharedInfoOpen ? " is-open" : ""}`}
                  >
                    <div className="pr-shared-inline-inner">
                    <div className="pr-shared-inline-head">
                      <span className="pr-shared-head-icon">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 11v5M12 8h.01" strokeLinecap="round" />
                        </svg>
                      </span>
                      <h3 className="pr-shared-title">ข้อมูลที่ใช้ร่วมกับทุกรายการ</h3>
                    </div>

                    {sharedGeneral.length > 0 && (
                      <div className="pr-shared-grid">
                        {sharedGeneral.map((column) => (
                          <div key={column.label} className="pr-shared-field">
                            <span className="pr-shared-field-icon">
                              <SharedFieldIcon label={column.label} />
                            </span>
                            <div className="pr-shared-field-body">
                              <span className="pr-shared-field-label">
                                {SHARED_FIELD_TH[column.label] ?? column.label}
                              </span>
                              <span className="pr-shared-field-value">
                                {text(column.value(detail[0])) || "-"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {(glAccount || costCenter) && (
                      <div className="pr-shared-cards">
                        {glAccount &&
                          (() => {
                            const { code, desc } = splitCodeDesc(glAccount);
                            return (
                              <div className="pr-shared-card">
                                <span className="pr-shared-card-icon">
                                  <SharedFieldIcon label="GL Account" />
                                </span>
                                <div className="pr-shared-card-body">
                                  <span className="pr-shared-field-label">GL Account</span>
                                  <span className="pr-shared-card-code">{code}</span>
                                  {desc && <span className="pr-shared-card-desc">{desc}</span>}
                                </div>
                              </div>
                            );
                          })()}
                        {costCenter &&
                          (() => {
                            const { code, desc } = splitCodeDesc(costCenter);
                            return (
                              <div className="pr-shared-card">
                                <span className="pr-shared-card-icon">
                                  <SharedFieldIcon label="Cost Center" />
                                </span>
                                <div className="pr-shared-card-body">
                                  <span className="pr-shared-field-label">Cost Center</span>
                                  <span className="pr-shared-card-code">{code}</span>
                                  {desc && <span className="pr-shared-card-desc">{desc}</span>}
                                </div>
                              </div>
                            );
                          })()}
                      </div>
                    )}

                    </div>
                  </div>
                )}

                <div className="pr-items-table-wrap">
                  <table className="pr-items-table">
                    <thead>
                      <tr>
                        <th className="pr-items-th-index" scope="col">
                          ITEM
                        </th>
                        <th scope="col">รายละเอียด</th>
                        <th className="pr-items-num" scope="col">
                          จำนวน
                        </th>
                        {showUnitPrice && (
                          <th className="pr-items-num" scope="col">
                            ราคาต่อหน่วย
                          </th>
                        )}
                        {showTotal && (
                          <th className="pr-items-num pr-items-num--total" scope="col">
                            มูลค่ารวม
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.map((row, index) => {
                        const qty = [text(row.quantity), text(row.unit)]
                          .filter(Boolean)
                          .join(" ");
                        const rowVarying = varyingColumns
                          .map((column) => ({ label: column.label, value: text(column.value(row)) }))
                          .filter((field) => field.value !== "");

                        return (
                          <tr
                            key={`${text(row.itemNo)}-${index}`}
                            className={sharedColumns.length > 0 ? "pr-items-row-clickable" : undefined}
                            onMouseDown={
                              sharedColumns.length > 0 ? (e) => e.stopPropagation() : undefined
                            }
                            onClick={
                              sharedColumns.length > 0 ? () => setSharedInfoOpen(true) : undefined
                            }
                          >
                            <td className="pr-items-td-index">
                              <span className="pr-items-index">
                                {text(row.itemNo) || index + 1}
                              </span>
                            </td>
                            <td className="pr-items-td-desc">
                              <span className="pr-items-title">
                                {text(row.shortText) || text(row.material) || "-"}
                              </span>
                              {text(row.material) && text(row.shortText) ? (
                                <span className="pr-items-material">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M21 8 12 3 3 8l9 5 9-5zM3 8v8l9 5 9-5V8" />
                                  </svg>
                                  {text(row.material)}
                                </span>
                              ) : null}
                              {rowVarying.length > 0 && (
                                <dl className="pr-items-chips">
                                  {rowVarying.map((field) => (
                                    <div key={field.label}>
                                      <dt>{field.label}</dt>
                                      <dd>{field.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                              )}
                            </td>
                            <td className="pr-items-num">{qty || "-"}</td>
                            {showUnitPrice && (
                              <td className="pr-items-num">{text(row.valuationPrice) || "-"}</td>
                            )}
                            {showTotal && (
                              <td className="pr-items-num pr-items-num--total">
                                {text(row.totalValue) || "-"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="pr-items-footer">
                  <div className="pr-items-footer-total">
                    <span className="pr-items-footer-total-label">มูลค่ารวมทั้งหมด</span>
                    <span className="pr-items-footer-total-value">
                      <CountUp raw={text(data.purTotalValue) || "-"} /> THB
                    </span>
                  </div>
                </div>
              </div>
            )}
          </section>

          {approvalHistory.length > 0 ? (
            <section id="approval-history" className="legacy-section pr-wire-panel">
              <div className="legacy-section-title">Approval History</div>
              <div className="table-frame">
                <table className="release-table">
                  <thead>
                    <tr>
                      <th className="row-index-head">Level</th>
                      <th>สถานะ</th>
                      <th>ผู้อนุมัติ</th>
                      <th>Date Time</th>
                      <th>File</th>
                      <th>Remark</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvalHistory.map((row) => {
                      const status = getApprovalHistoryStatus(row.approver);

                      return (
                        <tr key={row.level}>
                          <td className="row-index-cell">{row.level}</td>
                          <td>{status ? <span className={status.className}>{status.label}</span> : "-"}</td>
                          <td>{row.fullname || "-"}</td>
                          <td>{row.datetime || "-"}</td>
                          <td>{renderApprovalFiles(row.file)}</td>
                          <td>{row.remark || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {!aiDisabled && (
          <section
            className={`legacy-section pr-wire-panel ai-panel ai-panel--${aiAssist?.level ?? "warn"}${aiLoading ? " is-loading" : ""}`}
            aria-busy={aiLoading}
          >
            <div className="ai-head">
              <span className="ai-head-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4 7 17M17 7l1.4-1.4" />
                  <circle cx="12" cy="12" r="3.2" />
                </svg>
              </span>
              <h2 className="ai-head-title">ผลตรวจโดย AI</h2>
              {aiLoading ? (
                <span className="ai-loading">
                  <span className="ai-spinner" aria-hidden="true" />
                  AI กำลังวิเคราะห์…
                </span>
              ) : aiAssist ? (
                <span className={`ai-level ai-level--${aiAssist.level}`}>{aiAssist.levelText}</span>
              ) : (
                <span className="ai-level ai-level--flag">วิเคราะห์ไม่สำเร็จ</span>
              )}
              <div className="ai-head-meta">
                {text(data.purchasingDocument) && (
                  <span className="ai-head-doc">PR {text(data.purchasingDocument)}</span>
                )}
                {/* เวลาที่ AI ดึงข้อมูลมาวิเคราะห์ ให้ผู้อนุมัติรู้ว่าผลนี้เก่าแค่ไหน */}
                {aiAssist && formatAiTime(aiAssist.analyzedAt) && (
                  <span className="ai-head-time">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 7v5l3 2" />
                    </svg>
                    ข้อมูล ณ {formatAiTime(aiAssist.analyzedAt)}
                  </span>
                )}
              </div>
            </div>

            {aiLoading ? (
              <div className="ai-empty">
                <span className="ai-spinner ai-spinner--lg" aria-hidden="true" />
                <p>AI กำลังวิเคราะห์ใบขอซื้อนี้…</p>
              </div>
            ) : !aiAssist ? (
              <div className="ai-empty ai-empty--error">
                <p>ไม่สามารถวิเคราะห์ด้วย AI ได้ในขณะนี้</p>
                <span>ลองใหม่อีกครั้งภายหลัง หรือพิจารณาจากเอกสาร PR โดยตรง</span>
              </div>
            ) : (
            <>
            <div className="ai-body">
              <div className="ai-radar-wrap">
                <AiRadar scores={aiAssist.scores} />
                {/* Legend doubles as the scale key and the dot-colour key */}
                <ul className="ai-radar-legend">
                  <li>
                    <span className="ai-legend-dot ai-legend-dot--low" aria-hidden="true" />
                    1–2 ต้องพิจารณา
                  </li>
                  <li>
                    <span className="ai-legend-dot ai-legend-dot--mid" aria-hidden="true" />
                    3 พอใช้
                  </li>
                  <li>
                    <span className="ai-legend-dot ai-legend-dot--high" aria-hidden="true" />
                    4–5 ผ่าน
                  </li>
                </ul>
              </div>

              <div className="ai-scores">
                {canAct && (
                  <p className="ai-human-hint">
                    ให้คะแนนของคุณเทียบกับ AI ได้ทุกมุม (ไม่บังคับ) ระบบบันทึกให้ตอนกดอนุมัติหรือไม่อนุมัติ
                  </p>
                )}
                <table className="ai-score-table">
                  <thead>
                    <tr>
                      <th scope="col">มุมที่พิจารณา</th>
                      <th className="ai-score-num" scope="col">คะแนน</th>
                      <th scope="col">เหตุผลโดยย่อ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {AI_DIMENSIONS.map((dim, i) => {
                      const score = aiAssist.scores[i] ?? 0;
                      const tone = aiScoreTone(score);
                      const isPrice = dim.key === "price";
                      return (
                        <tr key={dim.key} className={tone === "low" ? "ai-row-low" : undefined}>
                          <td>
                            <span className="ai-dim-label">{dim.label}</span>
                            {/* ปุ่มที่มาราคาตลาด แสดงเฉพาะเมื่อ AI มีรายการราคาให้เทียบจริง ไม่มีก็ไม่ต้องมี dropdown */}
                            {isPrice && aiAssist.sources.length > 0 && (
                              <button
                                type="button"
                                className="ai-src-btn"
                                onClick={() => setAiPriceOpen((open) => !open)}
                                aria-controls="ai-price-panel"
                                aria-expanded={aiPriceOpen}
                              >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <circle cx="11" cy="11" r="7" />
                                  <path d="m20 20-3.5-3.5" />
                                </svg>
                                ที่มาราคาตลาด
                                <svg className="ai-src-btn-caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="m6 9 6 6 6-6" />
                                </svg>
                              </button>
                            )}
                          </td>
                          <td className="ai-score-num">
                            <span className={`ai-score-badge ai-score-badge--${tone}`}>{score}/5</span>
                            {canAct && (
                              <label className="ai-human-field">
                                <span className="ai-human-field-label">คุณ</span>
                                <select
                                  className="ai-human-score text-[13px]!"
                                  value={humanDims[dim.key]?.score ?? ""}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setHumanDims((prev) => ({
                                      ...prev,
                                      [dim.key]: { ...prev[dim.key], score: v === "" ? null : Number(v) },
                                    }));
                                  }}
                                  aria-label={`คะแนนของคุณ ${dim.label}`}
                                >
                                  <option value="">—</option>
                                  <option value="1">1</option>
                                  <option value="2">2</option>
                                  <option value="3">3</option>
                                  <option value="4">4</option>
                                  <option value="5">5</option>
                                </select>
                              </label>
                            )}
                          </td>
                          <td className="ai-reason">
                            <span className="ai-reason-text">{aiAssist.reasons[i] ?? "-"}</span>
                            {canAct && (
                              <input
                                type="text"
                                className="ai-human-reason"
                                value={humanDims[dim.key]?.reason ?? ""}
                                onChange={(e) =>
                                  setHumanDims((prev) => ({
                                    ...prev,
                                    [dim.key]: { ...prev[dim.key], reason: e.target.value },
                                  }))
                                }
                                placeholder="ความเห็นของคุณ (ถ้ามี)"
                                aria-label={`ความเห็นของคุณ ${dim.label}`}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {aiAssist.sources.length > 0 && (
                <div id="ai-price-panel" className={`ai-price${aiPriceOpen ? " is-open" : ""}`}>
                  <div className="ai-price-inner">
                    {aiAssist.sources.length > 0 ? (
                      <ul className="ai-price-list">
                        {aiAssist.sources.map((src) => (
                          <li key={`${src.store}-${src.name}`} className="ai-price-row">
                            <span className="ai-price-main">
                              <span className="ai-price-store">{src.store}</span>
                              {src.url ? (
                                <a
                                  className="ai-price-link"
                                  href={src.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {src.name}
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
                                  </svg>
                                </a>
                              ) : (
                                <span className="ai-price-name">{src.name}</span>
                              )}
                            </span>
                            <span className="ai-price-value">{src.price}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ai-price-empty">ไม่มีข้อมูลราคาตลาดสำหรับรายการนี้</p>
                    )}
                    {aiAssist.sourceNote && <p className="ai-price-note">{aiAssist.sourceNote}</p>}
                  </div>
                </div>
                )}
              </div>
            </div>

            <div className="ai-callouts">
              <div className={`ai-callout ai-callout--${aiAssist.level}`}>
                <span className="ai-callout-label">สรุปผลตรวจ</span>
                <p>{aiAssist.summary}</p>
              </div>
              <div className="ai-callout ai-callout--advice">
                <span className="ai-callout-label">คำแนะนำ AI</span>
                <p>{aiAssist.advice}</p>
              </div>
            </div>

            <p className="ai-disclaimer">
              AI รวบรวมราคาตลาดและสรุปประเด็นให้เป็นข้อมูลประกอบเท่านั้น การอนุมัติเป็นดุลยพินิจของผู้มีอำนาจ
              ไม่ใช้ข้อมูลส่วนบุคคลของผู้ขอในการตัดสิน (PDPA) และราคาตลาดอ้างอิงเปลี่ยนแปลงได้
            </p>
            </>
            )}
          </section>
          )}

          {canAct && (
          <section className="legacy-section pr-wire-panel pr-wire-comment-panel">
            <div className="legacy-section-title">Comment</div>

            <div className="approval-bar pr-wire-approval-bar">
              <div className="approval-comment-row">
              <textarea
                id="approval-comment"
                className="approval-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Add comment (optional)"
                rows={4}
                disabled={submitting !== null}
              />

              <label
                htmlFor="approval-attach"
                className={`approval-dropzone${submitting !== null ? " approval-dropzone-disabled" : ""}`}
              >
                <input
                  ref={attachInputRef}
                  id="approval-attach"
                  type="file"
                  className="approval-attach-input"
                  onChange={handleAttachFiles}
                  disabled={submitting !== null}
                  multiple
                />
                <svg
                  className="approval-dropzone-icon"
                  xmlns="http://www.w3.org/2000/svg"
                  width="44"
                  height="44"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                  />
                </svg>
                <span className="approval-dropzone-title">
                  {attachedFiles.length > 0
                    ? `${attachedFiles.length} file${attachedFiles.length > 1 ? "s" : ""} attached`
                    : "No file attached"}
                </span>
                <span className="approval-dropzone-hint">
                  Click to browse and attach files
                </span>
                <span className="approval-dropzone-action">Attach file</span>
              </label>
              </div>

              {attachedFiles.length > 0 ? (
                <div className="approval-attach-list">
                  {attachedFiles.map((file) => (
                    <div
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="approval-attach-item"
                    >
                      <span className="approval-attach-name">{file.name}</span>
                      <button
                        type="button"
                        className="approval-attach-remove"
                        onClick={() =>
                          handleRemoveFile(`${file.name}-${file.size}-${file.lastModified}`)
                        }
                        disabled={submitting !== null}
                        aria-label={`Remove ${file.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {feedback ? (
                <div
                  className={
                    feedback?.tone === "success"
                      ? "approval-message approval-message-success"
                      : "approval-message approval-message-error"
                  }
                >
                  {feedback?.message}
                </div>
              ) : null}

              <div className="approval-actions pr-wire-actions">
                <button
                  type="button"
                  className="approval-button reject-button"
                  onClick={() => handleAction("REJECT")}
                  disabled={submitting !== null}
                >
                  {submitting === "REJECT" ? "Rejecting..." : "Reject"}
                </button>
                <button
                  type="button"
                  className="approval-button approve-button"
                  onClick={() => handleAction("APPROVE")}
                  disabled={submitting !== null}
                >
                  {submitting === "APPROVE" ? "Approving..." : "Approve"}
                </button>
              </div>
            </div>
          </section>
          )}
        </main>
    </>
  );
}
