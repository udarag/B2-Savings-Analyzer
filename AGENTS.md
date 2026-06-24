<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Shared Project Context

Before non-trivial work, read `docs/agent-context.md`. It captures the current app architecture, production deployment flow, validation gates, and product constraints that all coding agents should share.

If `PROJECT_CONTEXT.local.md` exists in the checkout, read it too. It is intentionally ignored by git and may contain machine-specific deployment notes, current VM state, or sensitive local handoff context. Keep it out of commits.
