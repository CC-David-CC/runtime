# Runtime

API2 mount remains synchronous. App instances also expose the mounted view's explicit ready, inspect, execute and requestClose interfaces when present. The existing viewer awaits app-owned close decisions while retaining its original window chrome and lifecycle cleanup.

The public JS `@webos/runtime/file-protocol` and Python `webos_runtime.file_protocol` load the same immutable account-file wire constants. These stateless contracts let Accounts and Storage agree on proof types and routes without importing each other's private server implementation. The Python package uses the standard library.
