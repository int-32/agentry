# Channels TDD

Full feature spec: `../../docs/specs/features/channels-and-agent-collaboration.md`

## Test Matrix

| ID | Spec IDs | Test file | Coverage | Command | Status |
| --- | --- | --- | --- | --- | --- |
| AG-TDD-CHANNEL-001 | AG-EARS-CHANNEL-001, AG-BDD-CHANNEL-001 | `tests/channel-store-locking.test.js` | channel file write/read | `npm test -- tests/channel-store-locking.test.js` | needs-review |
| AG-TDD-CHANNEL-002 | AG-EARS-CHANNEL-002, AG-BDD-CHANNEL-002 | `tests/channel-router-agent-order.test.js`, `tests/channel-router-trigger.test.js` | member validation and routing assumptions | `npm test -- tests/channel-router-agent-order.test.js tests/channel-router-trigger.test.js` | needs-review |
| AG-TDD-CHANNEL-003 | AG-EARS-CHANNEL-003, AG-BDD-CHANNEL-003 | `tests/channel-store-locking.test.js` | concurrent write serialization | `npm test -- tests/channel-store-locking.test.js` | needs-review |
| AG-TDD-CHANNEL-004 | AG-EARS-CHANNEL-004, AG-BDD-CHANNEL-004 | `tests/channel-router-reply-tools.test.js`, `tests/channel-router-memory-master.test.js` | non-member routing and reply tools | `npm test -- tests/channel-router-reply-tools.test.js tests/channel-router-memory-master.test.js` | needs-review |
| AG-TDD-CHANNEL-006 | AG-EARS-CHANNEL-006, AG-BDD-CHANNEL-006, AG-BDD-PROJECT-004 | `tests/channels-route.test.js` | project id validation, channel frontmatter project snapshot, channel list/read projection | `npm test -- tests/channels-route.test.js` | needs-review |
| AG-TDD-CHANNEL-008 | AG-EARS-CHANNEL-008, AG-BDD-CHANNEL-008 | `tests/channels-route.test.js`, `tests/channel-router-reply-tools.test.js` | task-board binding frontmatter/projection and channel task execution defaults | `npm test -- tests/channels-route.test.js tests/channel-router-reply-tools.test.js` | needs-review |

## Minimum Verification

For channel file format, member validation, project snapshot metadata, task-board metadata, or locking changes, run:

```bash
npm test -- tests/channel-store-locking.test.js tests/channels-route.test.js
```

For channel routing changes, run:

```bash
npm test -- tests/channel-router-agent-order.test.js tests/channel-router-trigger.test.js tests/channel-router-reply-tools.test.js tests/channel-router-memory-master.test.js
```
