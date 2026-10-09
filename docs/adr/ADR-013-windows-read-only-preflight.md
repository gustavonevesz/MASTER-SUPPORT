# ADR-013 — Windows read-only preflight

- Status: Aceito
- Data: 2026-10-09

## Contexto

O primeiro retrato operacional de um Windows precisa reutilizar o backbone de Observation, preservar provenance e evitar que inventário temporário seja promovido a identidade permanente.

## Decisão

Preflight é um workflow do Server, não uma mega-capability nem um script. Ele executa sequencialmente cinco capabilities obrigatórias R0, read-only e non-admin: runtime, OS, memória, storage local fixo e contexto de execução. Cada handler possui fonte específica e não aceita comando, script, path ou alvo arbitrário.

O lifecycle agregado é `Running → Completed|Partial|Failed|Cancelled`; restart durável converte trabalho antigo em `Interrupted`, sem reexecução. Um snapshot bounded referencia Observations e não duplica RAW Evidence. O máximo de storage é 32 volumes.

`ObservedEndpoint` pertence a exatamente uma Session. `ObservedMachineName` é INTERNAL, mutável e não confiável para correlação. Mesmo hostname em Sessions diferentes não unifica endpoints e não cria Asset.

## Consequências

O fluxo é previsível e auditável, com menor paralelismo e sem diagnóstico. Endpoint comprometido ainda pode falsificar fatos; provenance descreve como o Agent os coletou, não garante sua veracidade. Identidade permanente, confirmação de Asset, UI, ações mutáveis e IA exigem etapas futuras próprias.
