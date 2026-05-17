# @agentry/plugin-components

React component primitives for Agentry plugin iframes.

```tsx
import {
  Button,
  CardShell,
  HanaThemeProvider,
  SettingRow,
  Switch,
} from '@agentry/plugin-components';
import '@agentry/plugin-components/styles.css';

export function PluginPanel() {
  return (
    <HanaThemeProvider mode="inherit">
      <CardShell title="Sync">
        <SettingRow
          label="Enabled"
          hint="Follows the current Agentry theme."
          control={<Switch checked label="On" />}
        />
        <Button variant="primary">Run</Button>
      </CardShell>
    </HanaThemeProvider>
  );
}
```

`HanaThemeProvider` has three modes:

- `inherit`: use host CSS variables when the iframe receives them, then fall back to Agentry defaults from `styles.css`.
- `hana`: set one of Agentry's named theme token groups, such as `warm-paper` or `midnight`.
- `custom`: set only the tokens you provide. Missing tokens still fall back through host variables and SDK defaults.

Components intentionally expose stable `hana-plugin-*` classes so plugin authors can add small local refinements without depending on Agentry renderer internals.
