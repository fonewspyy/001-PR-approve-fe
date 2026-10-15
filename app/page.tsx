import PrApproveView from "./PrApproveView";
import { fetch8BitPRApprove, type PurchaseReq } from "@/lib/api/api8bit";

function Notice({ title, message }: { title: string; message: string }) {
  return (
    <main className="legacy-page">
      <section className="legacy-section">
        <div className="legacy-section-title">Purchase Req.</div>
        <div className="tab-content">
          <div className="tab-content-row">
            <div className="tab-content-label">{title}</div>
            <div className="tab-content-value tab-content-textarea">{message}</div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ processInstanceId?: string; TaskID?: string; taskId?: string; username?: string; fullName?: string; source?: string }>;
}) {
  const { processInstanceId, TaskID, taskId, username, fullName, source } = await searchParams;
  const trimmedId = processInstanceId?.trim();
  const trimmedTaskId = TaskID?.trim() || taskId?.trim() || "";
  const canAct = source?.trim().toLowerCase() === "inbox";

  if (!trimmedId) {
    return (
      <Notice
        title="Missing processInstanceId"
        message="Open this page with ?processInstanceId=... to load the purchase requisition."
      />
    );
  }

  let data: PurchaseReq | null = null;
  let errorMessage = "";

  try {
    data = await fetch8BitPRApprove(trimmedId);
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : "Failed to load purchase requisition.";
  }

  if (errorMessage || !data) {
    return (
      <Notice
        title="Unable to load purchase requisition"
        message={errorMessage || "No data returned from PRApprove."}
      />
    );
  }

  return (
    <PrApproveView
      data={data}
      processInstanceId={trimmedId}
      taskId={trimmedTaskId}
      username={username?.trim() ?? ""}
      fullName={fullName?.trim() ?? ""}
      workflowSteps={data.workflow ?? []}
      canAct={canAct}
    />
  );
}
