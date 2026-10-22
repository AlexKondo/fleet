# Cobertura das 28 telas — 22/10/2026

As 28 telas continuam consideradas aprovadas no histórico do usuário. Disponibilidade de arte neste ZIP não redefine essa aprovação. Nenhum layout foi redesenhado. Não houve E2E autenticado das 28 telas nesta execução.

| Tela | Rotas | Referência disponível | Verificação e limite |
|---|---|---|---|
| SCR-FM-001 | /dashboard/command-center | PNG disponível | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-FM-002 | /fleet; /fleet/vehicles/[id] | PNG Rev.04 disponível; inspecionado nesta rodada | Renderização automatizada + hidratação do cadastro em 1536/390; histórico/GPS completo pendente |
| SCR-FM-003 | /dashboard; /trips; /reservations/[id] | Arte completa não localizada neste snapshot | SQL reservas/escopo + ação de exceção e formulário local; E2E integrado pendente |
| SCR-FM-004 | /fleet/carpools; /analytics/carpool; /carpool | PNG Rev.02 disponível | Busca testada com pontos corporativos; composição de gestão testada; Google real pendente |
| SCR-FM-005 | /fleet/maintenance; /maintenance/planning | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-FM-006 | /fleet/energy | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-FM-007 | /fleet/drivers; /settings/users | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-FM-008 | /fleet/incidents | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-FM-009 | /analytics; /analytics/carpool | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-USR-001 | /dashboard | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-USR-002 | /trips/new | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-USR-003 | /carpool | Arte completa não localizada neste snapshot | Busca testada com pontos corporativos; composição de gestão testada; Google real pendente |
| SCR-USR-004 | /trips; /reservations/[id] | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-USR-005 | /reservations/[id]/pickup; /reservations/[id]/return | Arte completa não localizada neste snapshot | SQL local de inspeção/custódia; integração Auth/Storage/portaria pendente |
| SCR-USR-006 | /carpool/mine; /trips?tab=carpools | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-SEC-001 | /gate | Arte completa não localizada neste snapshot | SQL local de inspeção/custódia; integração Auth/Storage/portaria pendente |
| SCR-SEC-002 | /gate/exceptions | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-SEC-003 | /gate/history | Arte completa não localizada neste snapshot | SQL local de inspeção/custódia; integração Auth/Storage/portaria pendente |
| SCR-MNT-001 | /maintenance | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-MNT-002 | /maintenance/planning | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-MNT-003 | /maintenance/work-orders | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-MNT-004 | /maintenance/vehicles | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-ADM-001 | /admin | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-ADM-002 | /settings/users | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-ADM-003 | /settings; /settings/mobility-points; /admin/units | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-ADM-004 | /admin/integrations | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-ADM-005 | /admin/audit; /account/privacy | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |
| SCR-ADM-006 | /admin/ai | Arte completa não localizada neste snapshot | Inspeção estática de rotas; E2E autenticado pendente |

Divergências herdadas: painéis históricos/GPS/indicadores metodológicos e recorrência têm lacunas registradas na matriz original `docs/fleetmind-v3/MATRIZ_28_TELAS.md`. As 13 páginas de transição são uma pendência relatada anteriormente, não uma contagem reconfirmada por navegador nesta rodada. A arte FM-002 mostra mapa ao vivo, históricos, consumo e Intelligence; o teste estrutural não comprova fidelidade desses dados/painéis. Não foram substituídos por valores fictícios. Recuperar as demais referências e fazer confronto autenticado é condição de aceite visual.
