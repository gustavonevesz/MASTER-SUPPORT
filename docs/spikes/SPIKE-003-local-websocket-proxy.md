# SPIKE-003 — WebSocket através de reverse proxy local

Status: experimento executável da FOUNDATION-004; não promove a ADR-009.

## Harness

O teste cria um proxy TCP/HTTP local entre cliente WebSocket e Server, ambos em portas dinâmicas. Pelo proxy, executa upgrade, `AgentHello`, heartbeat correlacionado, queda abrupta do proxy, detecção de disconnect, criação de um novo proxy, resume manual e fechamento limpo. Um segundo cenário envia mensagem acima de 64 KiB e exige falha explícita. O teste de slow consumer separado força `bufferedAmount` acima do limite e confirma fechamento `1013` sem enfileiramento adicional.

## O que prova

- o upgrade e o tráfego bidirecional sobrevivem a um salto intermediário local;
- heartbeat, close e disconnect continuam observáveis;
- queda do intermediário não vira fechamento limpo;
- reconexão/resume exigem ação explícita e não reexecutam requests;
- o limite de entrada de 64 KiB e o limite bounded de saída continuam aplicados.

## O que não prova

Não mede proxy corporativo, TLS, autenticação, Cloudflare, balanceadores, idle timeout real, NAT, perda/latência de rede, múltiplas instâncias, volume de produção ou compatibilidade com produtos específicos. O proxy é um harness local deliberadamente pequeno. Por isso, WebSocket permanece `Trial` e ainda precisa de validação na infraestrutura e rede reais antes do piloto.
