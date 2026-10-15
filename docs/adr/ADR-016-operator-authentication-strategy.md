# ADR-016 — Operator authentication strategy

Status: Accepted (CORE-002)

## Context

The loopback-only console needs human identity, persistent browser sessions, `console.read` authorization and security auditing without becoming an identity provider. No Active Directory or Microsoft Entra deployment is assumed.

## Options considered

| Option | Strengths | Constraints / decision |
|---|---|---|
| OIDC Authorization Code + PKCE | Browser SSO, provider MFA, standards, mature Node support | Selected production provider; configured issuer/client required. |
| Windows Integrated / Kerberos | Strong SSO where AD, SPN and browser policy exist | Deferred: assumptions are unverified; silent NTLM fallback is unacceptable. |
| Local username/password | No corporate dependency | Rejected: password lifecycle, recovery, MFA and lockout would make Master Support an IdP. |
| Mutual TLS | Strong certificate identity | Deferred for human browsers due to provisioning and usability cost. |

## Decision

Define `OperatorAuthProvider`. Use `openid-client` for production OIDC discovery and Authorization Code with PKCE, state and nonce; only stable subject and display name enter the domain. The BFF never sends provider tokens to React and does not persist them. Loopback-only dev and isolated test providers implement the same one-time callback contract.

Operators are preprovisioned and Active. `OperatorReader` grants only `console.read`. A random opaque token is placed in an HttpOnly, SameSite=Strict, Path=/ cookie (Secure on HTTPS); PostgreSQL stores only SHA-256, TTL and revocation metadata. Logout validates origin plus token-bound CSRF and revokes server-side. OperatorSession may survive restart; it never preserves Agent SupportSession authority. CORE-002 remains on literal `127.0.0.1`.

## Consequences

Production startup needs OIDC configuration and preprovisioning. Dev auth needs explicit enablement and configured identity. Future remote exposure, expanded RBAC and IdP logout synchronization require separate decisions.
