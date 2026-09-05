# TEST STRATEGY

## Unit Tests
- business rules
- scoring
- readiness
- range calculation
- state transitions

## Integration Tests
- repositories
- transactions
- domain event handlers
- object storage adapter
- notifications

## API Contract Tests
Validate request/response/error behavior.

## E2E
Golden scenarios are mandatory.

## Regression
Every bug fix requires a regression test when feasible.

## Multi-agent QA
Feature agent cannot self-approve final QA for its own implementation pack.
