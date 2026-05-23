# <Feature Name>

Status: draft
Owner: TBD
Last updated: YYYY-MM-DD

Authoring rules: `../AUTHORING.md`

## Scope

说明这个规格覆盖什么、不覆盖什么。

## Code Map

| Area | Path |
| --- | --- |
| Core | `core/...` |
| Library | `lib/...` |
| Server | `server/routes/...` |
| Desktop | `desktop/src/react/...` |
| Tests | `tests/...` |

## Terms

| Term | Meaning |
| --- | --- |
| TBD | TBD |

## EARS Requirements

| ID | Type | Requirement | Linked BDD | Test |
| --- | --- | --- | --- | --- |
| AG-EARS-XXX-001 | Ubiquitous | The system shall ... | AG-BDD-XXX-001 | AG-TDD-XXX-001 |

## BDD Scenarios

```gherkin
Feature: <Feature Name>

  Scenario: <Scenario Title> [AG-BDD-XXX-001]
    Given <context>
    When <event>
    Then <observable result>
```

## TDD Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-XXX-001 | AG-EARS-XXX-001, AG-BDD-XXX-001 | `tests/example.test.js` | success path | `npm test -- tests/example.test.js` | planned |

## Manual Verification

- TBD

## Open Questions

- TBD
