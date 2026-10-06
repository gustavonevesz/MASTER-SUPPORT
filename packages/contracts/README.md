# Protocol contracts

JSON Schema 2020-12 is the language-neutral source of truth. Schemas are self-contained so TypeScript and C# load the exact same artifacts without generated domain code.

- Product version: release of the whole Master Support product (`0.1.0` initially).
- Agent version: independent Runtime release (`0.1.0` initially).
- Protocol version: compatibility line of messages (`1.0` initially).

Protocol `1.0` means the first contract line, not product maturity. Consumers reject unsupported versions. Compatible additions must remain optional; breaking changes require a new protocol version. JSON property names are protocol wire names and therefore stable inside a protocol line.

FOUNDATION-003 adds `ObservationRequest`, `ObservationAccepted`, `ObservationResult` and `ObservationFailed`. They model one negotiated R0/read-only collection, with Evidence RAW and factual Observation as distinct values. `requestId` identifies the operation; `messageId` identifies each wire message; `correlationId` carries the request ID across the exchange.

All current schemas remain inside the documented C# validator subset. No schema defines authentication, trusted Asset identity, remote jobs, arbitrary command execution, policy or approval.
