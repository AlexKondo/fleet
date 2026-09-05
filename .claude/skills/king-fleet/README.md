# king-fleet

Gauntlet Loop para manutenção evolutiva de sistemas existentes.

## Instalação

Coloque `SKILL.md` na pasta de skills da sua IDE.

A skill pressupõe que `using-superpowers` e `playwright` já estejam instaladas na IDE e instrui os agentes a utilizá-las quando aplicável.

## Núcleo

- `/docs` como fonte inicial
- Technical Baseline
- Master Issue Registry
- Human Approval Gate
- 12 funções com Executor + Reviewer independente
- comunicação entre agentes
- Git worktrees/branches
- commits rastreáveis
- TDD adaptado
- Triple Validation Gate
- Evidence Packages
- Repair Loop
- Integration Gate
- Chief Reviewer
- Completion Audit

## Princípio

**Evidence over Claims.**

A execução só termina quando:

`Chief Reviewer = PASS`

e

`Completion Audit = PASS`.
