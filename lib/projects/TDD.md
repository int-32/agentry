# Projects TDD

Full feature spec: `../../docs/specs/features/project-registry.md`

## Test Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-PROJECT-001 | AG-EARS-PROJECT-001, AG-BDD-PROJECT-001 | `tests/projects-route.test.js` | create/list/update/delete project registry entries and JSON-backed projections | `npm test -- tests/projects-route.test.js` | needs-review |
| AG-TDD-PROJECT-002 | AG-EARS-PROJECT-002, AG-BDD-PROJECT-002 | `tests/projects-route.test.js` | missing name and invalid workspace/docs root rejection | `npm test -- tests/projects-route.test.js` | needs-review |
| AG-TDD-PROJECT-003 | AG-EARS-PROJECT-003, AG-BDD-PROJECT-003 | `tests/projects-route.test.js` | `projects-changed` app event emission on successful writes | `npm test -- tests/projects-route.test.js` | needs-review |
| AG-TDD-PROJECT-004 | AG-EARS-PROJECT-004, AG-BDD-PROJECT-004 | `tests/channels-route.test.js` | channel creation with project id and project snapshot exposure | `npm test -- tests/channels-route.test.js` | needs-review |

## Minimum Verification

For project registry API or persistence changes, run:

```bash
npm test -- tests/projects-route.test.js
```

For channel project linking changes, also run:

```bash
npm test -- tests/channels-route.test.js
```
