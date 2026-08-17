<!-- START CODEGRAPH BLOCK -->
## CodeGraph Context & Exploration
This project utilizes CodeGraph for local codebase intelligence and rapid semantic exploration. 

- **Always prioritize CodeGraph tools** (`codegraph_search`, `codegraph_context`) over brute-force `grep` or reading entire directory structures.
- **Save tokens** by leveraging CodeGraph's pre-indexed graph to surface relevant modules, dependencies, and code hierarchies.
- **Before major implementations**, use CodeGraph to map relationships between structural elements (classes, functions, imports) across the codebase.
- **If the database is missing or stale**, you can prompt the user to run `codegraph init` in the terminal to rebuild the `.codegraph/` index directory.
<!-- END CODEGRAPH BLOCK -->
