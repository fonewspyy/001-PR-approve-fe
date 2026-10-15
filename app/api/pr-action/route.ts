import { submitPRSubmit, type PRSubmitPayload } from "@/lib/api/api8bit";

const str = (value: unknown) => (typeof value === "string" ? value : "");

export async function POST(request: Request) {
  try {
    const form = await request.formData();

    const processInstanceId = str(form.get("processInstanceId")).trim();
    if (!processInstanceId) {
      return Response.json({ message: "processInstanceId is required" }, { status: 400 });
    }

    const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);

    const payload: PRSubmitPayload = {
      taskID: str(form.get("taskID")),
      processInstanceId,
      purchasingDocument: str(form.get("purchasingDocument")),
      resultApprove: str(form.get("resultApprove")),
      fullnameApprove: str(form.get("fullnameApprove")),
      remarkApprove: str(form.get("remarkApprove")),
      datetimeApprove: str(form.get("datetimeApprove")),
      files,
    };

    const result = await submitPRSubmit(payload);

    return Response.json(result, { status: result.isSuccess ? 200 : 500 });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Failed to submit action." },
      { status: 500 }
    );
  }
}

// touch: refresh submit handler
