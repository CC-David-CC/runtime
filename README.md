# Runtime

API2 mount remains synchronous. App instances also expose the mounted view's explicit ready, inspect, execute and requestClose interfaces when present. The existing viewer awaits app-owned close decisions while retaining its original window chrome and lifecycle cleanup.

The public JS `@webos/runtime/file-protocol` and Python `webos_runtime.file_protocol` load the same immutable account-file wire constants. These stateless contracts let Accounts and Storage agree on proof types and routes without importing each other's private server implementation. The Python package uses the standard library.

API2 also forwards a mounted view's optional synchronous `focus()` method. The
view owns what receives keyboard focus and whether it is ready; Runtime does not
create, reload or replace its document. This additive JS host change does not
change the Python account-file wire protocol or require a backend restart.

`@webos/runtime/account-autosave` schedules existing app-owned account Save
operations. Browser recovery remains an independent, account-scoped local
journal; a browser checkpoint is never an account-save acknowledgement.
Applications provide an opaque resource identity, native content revision,
dirty flag and native eligibility. Unsaved/unnamed imports, unfinished native
edits, IME composition, dialogs and session-ending pauses are ineligible. The
app rechecks eligibility and authority before capturing the real native model;
background Save must not settle an active editor or take keyboard focus.

The default policy waits 10 seconds after a committed edit, permits automatic
account writes no more often than once per 60 seconds per view, and bounds
continuous eligible editing to 120 seconds before an attempt. At most two
automatic Save callbacks run concurrently in one page; this is client load
smoothing, not server authorization or a site-wide concurrency guarantee.
Manual Save stays immediate and uses the same conditional Storage/native
acknowledgement path. After it confirms, call `confirmed({identity})` to begin
the cooldown and clear a resolved conflict pause.

`save({identity,version,signal})` returns `saved` only after both the server's
saved revision and native adoption are confirmed. `unchanged` means no changed
content needs a write. `busy` postpones a native editing race. `retry` is allowed
only for an explicitly known no-write transient rejection; retry delays double
from 30 seconds to a 15-minute ceiling with up to 20% positive jitter (also capped).
An explicit server Retry-After may require a longer wait. Typing does not reset
backoff. All conflicts, uncertain results and thrown errors pause automatic
saves; the scheduler never replays a possibly committed write. `resume()` is
for explicit resolution, not a periodic retry button substitute. Late results
are fenced to their original resource identity; newer edits remain dirty.

`onState`/`inspect()` expose only scheduling state, next monotonic due time,
failure count and reason, with no document payload or credentials. Dispose the
scheduler with its view. Apps own status wording, native serialization,
account authorization, local recovery and conflict resolution.
