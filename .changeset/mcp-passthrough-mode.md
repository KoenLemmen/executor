---
"@executor-js/sdk": patch
"@executor-js/execution": patch
"executor": patch
---

Add a search and invoke MCP mode (`?mode=passthrough`, `executor mcp --mode passthrough`). Search returns bounded pages of matching tool IDs and input schemas. Invoke validates arguments and runs the selected tool, with native client approval and workspace blocks enforced. The MCP catalog stays at two tools regardless of integration count.
