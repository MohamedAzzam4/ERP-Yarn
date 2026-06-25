import type { NextConfig } from "next";

/**
 * Next.js configuration for ERP-Yarn MVP.
 *
 * WP-00-02 scope: technical stack baseline only. No business logic, no
 * rewrites, no experimental features that bypass the contracted Node.js
 * runtime path for high-risk Route Handlers.
 *
 * Contract references:
 *  - docs/contracts/01_technical_architecture_and_deployment_contract.md
 *    (App Router, Node.js runtime for high-risk handlers, server-only secrets)
 *  - docs/contracts/13_work_packages.md WP-00-02 (no business API routes yet)
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // High-risk Route Handlers must run on the Node.js runtime, never Edge.
  // Per-route `export const runtime = "nodejs"` is enforced on each handler.
  // No experimental features that bypass server-side permission/transaction guards.
  poweredByHeader: false,
  // Keep build deterministic; do not inline heavy server-only secrets.
  experimental: {},
};

export default nextConfig;
