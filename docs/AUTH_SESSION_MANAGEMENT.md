# Authentication Session Management

SentinelAI exposes authenticated session management so users can inspect and revoke their own refresh-token families.

## Endpoints

All endpoints require an access token in the `Authorization: Bearer <token>` header.

### List active sessions

`GET /api/v1/auth/sessions`

Returns up to 100 active sessions for the authenticated user and the exact workspace membership in the access token. Each item includes:

- `sessionId`: opaque refresh-token family identifier used for revocation.
- `createdAt`: first token creation time in the family.
- `lastUsedAt`: latest token creation/rotation time in the family.
- `activeTokenCount`: number of currently active, unexpired refresh tokens in the family.

The API intentionally does not infer or fabricate device names, IP addresses, or geolocation; those attributes are not collected by the current authentication flow.

### Revoke a session

`DELETE /api/v1/auth/sessions/:sessionId`

Revokes every unrevoked refresh token in the selected family and writes an `auth.session.revoke` event to the append-only organization audit log in the same database transaction.

The operation is scoped by user ID, organization ID, and membership ID. A session belonging to another user or workspace is reported as not found. Invalid session identifiers are rejected.

## Immediate access-token invalidation

Access tokens include the session-family identifier. The authentication guard verifies that the family still has an unrevoked, unexpired refresh token on every protected request. Revoking a session therefore invalidates its existing access tokens immediately, rather than waiting for their 15-minute JWT expiry.

Refresh-token rotation preserves the family identifier, so normal token refresh does not invalidate the session. Reuse detection and logout revoke the family and consequently invalidate its access tokens as well.

## Operational considerations

- Session listing is limited to the 100 most recently active session families.
- The current flow does not collect device fingerprints, IP addresses, user-agent strings, or location. The UI should not present those as known facts.
- A user can revoke sessions only within the workspace membership represented by their current access token. To manage another workspace, authenticate to that workspace first.
