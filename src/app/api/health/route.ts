import { NextResponse } from "next/server";
import { performHealthCheck } from "@/server/health/health-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await performHealthCheck();
  return NextResponse.json(result, {
    status: result.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
  });
}
