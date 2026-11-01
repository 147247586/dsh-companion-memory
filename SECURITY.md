# Security

## Data

- This plugin stores memory in the host's local `documents`/`storage` API.
- It does not ship with any chat logs, persona, API keys, account identifiers, or media.
- `model_generate` is used only for the daily consolidation step and costs host model tokens.

## Prompt injection

Recalled memories are wrapped in a clearly labeled local context block and are
treated as reference data, not instructions. The consolidation prompt asks the
model to emit JSON only; generated text is sanitized and length-limited.

## Reporting

Please open a private security advisory if you find a vulnerability that could
expose local memory or cause cross-chat data access.
