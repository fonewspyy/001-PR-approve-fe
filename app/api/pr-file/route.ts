import { fetch8BitFile } from "@/lib/api/api8bit";

// Streams a stored file from the 8Bit server through our own origin so the browser can
// open it (PDF/image inline) without a public link or exposing the API token.
export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path")?.trim();
  if (!path) {
    return new Response("path is required", { status: 400 });
  }

  try {
    const upstream = await fetch8BitFile(path);
    if (!upstream.ok || !upstream.body) {
      const message = await upstream.text().catch(() => "");
      return new Response(message.trim() || "Unable to load file", {
        status: upstream.status || 502,
      });
    }

    const fileName = path.split(/[\\/]/).pop() || "file";
    const headers = new Headers({
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
      "Cache-Control": "private, max-age=60",
    });
    const length = upstream.headers.get("content-length");
    if (length) headers.set("Content-Length", length);

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Unable to load file",
      { status: 500 }
    );
  }
}
