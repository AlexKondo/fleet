# SECURITY AND PERMISSIONS

## Authentication
Corporate-ready authentication abstraction.
MVP may use local/test auth if enterprise SSO is not yet available.

## Authorization
RBAC enforced server-side.
UI hiding is not authorization.

## Sensitive data
Protect:
- CNH
- employee identifiers
- contact data
- photos/evidence
- internal operational messages

## Upload security
- validate MIME type
- validate file size
- malware scanning hook
- private object storage
- signed/authorized access

## Critical actions requiring audit
- approve/reject
- block/unblock vehicle
- reassign vehicle
- modify fleet configuration
- alter driver authorization
- complete maintenance
- modify current vehicle location manually
- override readiness

## Principle
Least privilege.
