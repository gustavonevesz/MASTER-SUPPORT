# SPIKE-002 — Hospedagem do PowerShell

Status: análise documental; nenhuma execução PowerShell foi integrada ao Agent.

| Critério | SDK in-process / Runspace | Processo separado (`powershell.exe`/`pwsh.exe`) |
|---|---|---|
| Isolamento/crash | compartilha memória e falhas com Runtime | melhor contenção; processo pode ser encerrado |
| Timeout/cancelamento | APIs de pipeline oferecem controle fino, mas módulos podem bloquear | kill process é limite forte, com risco de ação parcial/filhos |
| stdout/stderr/streaming | streams tipados e objetos ricos | texto/encoding e streams separados exigem disciplina |
| Memória/startup | runspace reutilizável é eficiente, mas mantém estado | custo por processo; estado mais descartável |
| Segurança | host controla runspace, linguagem e comandos, mas in-process não é sandbox | separação não é sandbox; identidade/privilégio herdados |
| PS 5.1 vs 7/módulos | SDK escolhido pode divergir de módulos Windows legados | executável explícito facilita escolher 5.1 ou 7, mas compatibilidade varia |
| ExecutionPolicy | não é fronteira de segurança em nenhuma opção | idem |
| Encoding | objetos evitam parte dos problemas | PS 5.1 e 7 diferem; contrato explícito é obrigatório |
| Impersonation/elevação | complexo e perigoso dentro do processo | processo/broker dedicado oferece fronteira futura mais clara |

## Resultado

Para o primeiro Runtime de capabilities, processo separado é a hipótese inicial mais segura por contenção de crash, timeout forte e menor risco de contaminar o Agent. Isso não autoriza shell livre nem resolve sandbox, elevação ou efeitos parciais. Um spike futuro deve medir startup, cancelamento, encoding e módulos usando apenas comandos locais read-only.

PowerShell 5.1 está disponível nesta máquina; PowerShell 7 não está. Nenhum comando PowerShell foi executado pelo Agent e nenhuma dependência PowerShell foi adicionada.
