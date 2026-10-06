# ADR-003 — Modelo de sessão do agente

## Decisão recomendada

Primeira versão usa **Support Session temporária**, iniciada conscientemente, com conexão de saída, credenciais curtas e escopo por endpoint/sessão. Managed Endpoint persistente fica explicitamente fora do escopo.

## Status

Aceito na GATE-000.

## Contexto e alternativas

Sessão temporária reduz persistência, superfície e complexidade para provar a espinha dorsal. Agente persistente habilita heartbeat e gestão contínua, mas exige serviço Windows, updater, maior maturidade de identidade, consentimento e operação 24x7. Executável temporário é a escolha proporcional.

## Lifecycle e regras

`Created → Connecting → Active → Closing → Closed`, com saídas `Expired` e `Failed`. A sessão possui TTL, heartbeat/lease, vínculo imutável ao endpoint e revogação server-side e agent-side. Encerramento bloqueia novos Jobs, trata jobs ativos por política explícita, revoga autoridade e fecha canal. Reconexão só dentro de janela e identidade válidas.

## Trade-offs e consequências

- Técnico precisa iniciar cada atendimento; não há monitoramento contínuo.
- Não instalar serviço nem mecanismo de persistência na primeira fatia.
- Bootstrap seguro e limpeza local são requisitos centrais, não detalhes posteriores.
- “Canal desapareceu” significa também credencial expirada/revogada, não apenas socket fechado.

## Risco de lock-in

Baixo se Session e AgentIdentity não forem modelados como instalação persistente. Protocolo deve permitir futura modalidade managed sem relaxar políticas temporárias.

## Condições para revisar

Necessidade validada de telemetria/alerta contínuo, suporte sem presença local, ativos críticos gerenciados e maturidade para atualização/identidade persistentes.
