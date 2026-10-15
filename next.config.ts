import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served under /001 (e.g. http://localhost:3101/001) so the portal can embed it.
  // ต้องตรงกับ path ที่ public gateway :8900 กำหนด (linkProject = .../001) ไม่งั้น iframe 404
  basePath: "/001",
  // Only Lunar may frame this page (prod: same host :8900; dev: Lunar on :3100), so a
  // foreign site cannot embed it and click Approve/Reject under the viewer's session.
  async headers() {
    const ancestors = ["'self'", "https://oi.beger.co.th:8900"];
    if (process.env.NODE_ENV !== "production") ancestors.push("http://localhost:3100");
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: `frame-ancestors ${ancestors.join(" ")}` }],
      },
    ];
  },
};

export default nextConfig;
