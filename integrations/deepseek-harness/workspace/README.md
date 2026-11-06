# File workspace for DSH

Collect local file references and attachments from conversation history, preview files, and return to the original message or question. Session groups, Office/PDF thumbnails, related files, file details and temporary-file filtering share FiLens's local preview core.

Install both plugins, then reopen DSH Desktop:

```sh
dsh plugin --profile desktop add dsh-filens@0.1.8 dsh-filens-workspace@0.1.1
```

File workspace has its own plugin switch. Files remain in their original locations. Confirmed missing references are excluded after DSH metadata checks; refresh rechecks availability. Files deleted after scanning disappear when opening detects absence. Permission and connection errors retain their error states. Browser-selected files must be reopened after a reload. Related files use existing references without model calls.

Tested on macOS arm64 with DSH Desktop 0.2.1-rc.5. See the [setup guide and actual Desktop recordings](https://github.com/IceWhaleTech/filens/tree/main/integrations/deepseek-harness).
