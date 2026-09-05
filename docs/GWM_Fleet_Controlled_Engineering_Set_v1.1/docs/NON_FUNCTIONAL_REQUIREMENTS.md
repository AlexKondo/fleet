# NON-FUNCTIONAL REQUIREMENTS

## Performance
Normal read/write interactions should target <2s under normal corporate load.

## Concurrency
Prevent double booking under simultaneous requests.

## Reliability
Critical state changes transactional.

## Mobile usability
Check-in/out must be optimized for smartphone.

## Availability
Designed for daily corporate operational usage.

## Localization
PT-BR default.
Architecture i18n-ready.

## Accessibility
Core workflows keyboard/screen-reader aware where applicable.

## Observability
Structured logs, traceId, correlationId.

## Maintainability
Modules must have clear ownership and tests.

## Security
Server-side authorization and secure evidence handling.
