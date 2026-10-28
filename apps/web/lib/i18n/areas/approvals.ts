import type { AreaTexts } from "../areaText";

/** Screen /settings/approvals: direct manager of each person and the manager's WhatsApp number (approval by WhatsApp, migration 0229). */
type K =
  | "title" | "subtitle" | "howItWorks" | "channelOff" | "channelOn"
  | "colPerson" | "colRole" | "colManager" | "colWhatsapp" | "colStatus"
  | "noManager" | "whatsappPlaceholder" | "whatsappHint" | "consentLabel" | "save" | "saving" | "saved"
  | "statusReady" | "statusNoManager" | "statusManagerNoPhone" | "statusIsManager"
  | "errNotAuthorized" | "errInvalidPhone" | "errConsent" | "errInvalidManager" | "errNotFound" | "errUnknown"
  | "managerOf" | "empty";

export const approvalsTexts: AreaTexts<K> = {
  "pt-BR": {
    title: "Aprovação por WhatsApp",
    subtitle: "Defina o gestor direto de cada pessoa e o WhatsApp dele. Quando alguém reservar um veículo, o gestor recebe o pedido no WhatsApp e libera tocando em Aprovar.",
    howItWorks: "O gestor recebe: solicitante, veículo, data e hora de saída e de retorno, origem, destino e objetivo. Ao tocar em Aprovar, o veículo é liberado; em Recusar, a reserva é cancelada e o solicitante é avisado. O pedido vale por até 24 horas. A aprovação dentro do sistema continua funcionando.",
    channelOff: "O envio por WhatsApp ainda não foi ativado neste ambiente (falta ligar o n8n). Os cadastros abaixo já podem ser feitos; nenhuma mensagem será enviada até a ativação.",
    channelOn: "Envio por WhatsApp ativo.",
    colPerson: "Pessoa", colRole: "Perfil", colManager: "Gestor direto", colWhatsapp: "WhatsApp (de quem aprova)", colStatus: "Situação",
    noManager: "Sem gestor direto",
    whatsappPlaceholder: "(11) 98765-4321",
    whatsappHint: "Com DDD. Deixe em branco para remover.",
    consentLabel: "Confirmo que esta pessoa concordou em receber pedidos de aprovação neste número",
    save: "Salvar", saving: "Salvando…", saved: "Salvo",
    statusReady: "Pronto: os pedidos vão para o WhatsApp do gestor",
    statusNoManager: "Sem gestor direto: aprovação só no sistema",
    statusManagerNoPhone: "O gestor ainda não tem WhatsApp cadastrado",
    statusIsManager: "Gestor de {count} pessoa(s)",
    errNotAuthorized: "Somente administradores podem alterar este cadastro.",
    errInvalidPhone: "Número inválido. Use DDD + número, por exemplo (11) 98765-4321.",
    errConsent: "Marque a confirmação de que a pessoa concordou em receber os pedidos.",
    errInvalidManager: "Escolha um gestor ativo da mesma organização.",
    errNotFound: "Pessoa não encontrada.",
    errUnknown: "Não foi possível salvar agora. Tente novamente.",
    managerOf: "gestor de", empty: "Nenhuma pessoa cadastrada.",
  },
  "en-US": {
    title: "WhatsApp approval",
    subtitle: "Set each person's direct manager and the manager's WhatsApp. When someone books a vehicle, the manager gets the request on WhatsApp and releases it by tapping Approve.",
    howItWorks: "The manager receives: requester, vehicle, departure and return date and time, origin, destination and purpose. Tapping Approve releases the vehicle; tapping Reject cancels the booking and notifies the requester. A request is valid for up to 24 hours. Approving inside the system keeps working.",
    channelOff: "WhatsApp sending is not active in this environment yet (n8n still has to be connected). You can already fill in the records below; no message is sent until it is activated.",
    channelOn: "WhatsApp sending is active.",
    colPerson: "Person", colRole: "Role", colManager: "Direct manager", colWhatsapp: "WhatsApp (of the approver)", colStatus: "Status",
    noManager: "No direct manager",
    whatsappPlaceholder: "(11) 98765-4321",
    whatsappHint: "With area code. Leave blank to remove.",
    consentLabel: "I confirm this person agreed to receive approval requests on this number",
    save: "Save", saving: "Saving…", saved: "Saved",
    statusReady: "Ready: requests go to the manager's WhatsApp",
    statusNoManager: "No direct manager: approval only in the system",
    statusManagerNoPhone: "The manager has no WhatsApp registered yet",
    statusIsManager: "Manager of {count} person(s)",
    errNotAuthorized: "Only administrators can change this record.",
    errInvalidPhone: "Invalid number. Use area code + number, for example (11) 98765-4321.",
    errConsent: "Tick the confirmation that the person agreed to receive the requests.",
    errInvalidManager: "Choose an active manager from the same organization.",
    errNotFound: "Person not found.",
    errUnknown: "Could not save right now. Please try again.",
    managerOf: "manager of", empty: "No people registered.",
  },
  es: {
    title: "Aprobación por WhatsApp",
    subtitle: "Define el gestor directo de cada persona y su WhatsApp. Cuando alguien reserve un vehículo, el gestor recibe la solicitud por WhatsApp y la libera tocando Aprobar.",
    howItWorks: "El gestor recibe: solicitante, vehículo, fecha y hora de salida y de regreso, origen, destino y objetivo. Al tocar Aprobar, el vehículo se libera; al tocar Rechazar, la reserva se cancela y se avisa al solicitante. La solicitud vale hasta 24 horas. La aprobación dentro del sistema sigue funcionando.",
    channelOff: "El envío por WhatsApp aún no está activo en este entorno (falta conectar n8n). Ya puedes completar los registros; no se enviará ningún mensaje hasta la activación.",
    channelOn: "Envío por WhatsApp activo.",
    colPerson: "Persona", colRole: "Perfil", colManager: "Gestor directo", colWhatsapp: "WhatsApp (de quien aprueba)", colStatus: "Estado",
    noManager: "Sin gestor directo",
    whatsappPlaceholder: "(11) 98765-4321",
    whatsappHint: "Con código de área. Déjalo vacío para quitarlo.",
    consentLabel: "Confirmo que esta persona aceptó recibir solicitudes de aprobación en este número",
    save: "Guardar", saving: "Guardando…", saved: "Guardado",
    statusReady: "Listo: las solicitudes van al WhatsApp del gestor",
    statusNoManager: "Sin gestor directo: aprobación solo en el sistema",
    statusManagerNoPhone: "El gestor aún no tiene WhatsApp registrado",
    statusIsManager: "Gestor de {count} persona(s)",
    errNotAuthorized: "Solo los administradores pueden cambiar este registro.",
    errInvalidPhone: "Número no válido. Usa código de área + número, por ejemplo (11) 98765-4321.",
    errConsent: "Marca la confirmación de que la persona aceptó recibir las solicitudes.",
    errInvalidManager: "Elige un gestor activo de la misma organización.",
    errNotFound: "Persona no encontrada.",
    errUnknown: "No se pudo guardar ahora. Inténtalo de nuevo.",
    managerOf: "gestor de", empty: "Ninguna persona registrada.",
  },
  "zh-CN": {
    title: "WhatsApp 审批",
    subtitle: "为每个人设置直属主管及其 WhatsApp。有人预订车辆时，主管会在 WhatsApp 收到申请，点击“批准”即可放行。",
    howItWorks: "主管会收到：申请人、车辆、出发和返回的日期与时间、出发地、目的地和用途。点击“批准”放行车辆；点击“拒绝”将取消预订并通知申请人。申请最长有效 24 小时。系统内的审批仍然可用。",
    channelOff: "此环境尚未启用 WhatsApp 发送（还需连接 n8n）。您可以先填写下方信息；启用之前不会发送任何消息。",
    channelOn: "WhatsApp 发送已启用。",
    colPerson: "人员", colRole: "角色", colManager: "直属主管", colWhatsapp: "WhatsApp（审批人）", colStatus: "状态",
    noManager: "无直属主管",
    whatsappPlaceholder: "(11) 98765-4321",
    whatsappHint: "含区号。留空则删除。",
    consentLabel: "我确认此人同意在该号码接收审批申请",
    save: "保存", saving: "保存中…", saved: "已保存",
    statusReady: "已就绪：申请将发送到主管的 WhatsApp",
    statusNoManager: "无直属主管：仅可在系统内审批",
    statusManagerNoPhone: "主管尚未登记 WhatsApp",
    statusIsManager: "{count} 人的主管",
    errNotAuthorized: "只有管理员可以修改此记录。",
    errInvalidPhone: "号码无效。请填写区号加号码，例如 (11) 98765-4321。",
    errConsent: "请勾选确认：此人同意接收申请。",
    errInvalidManager: "请选择同一组织内的有效主管。",
    errNotFound: "未找到该人员。",
    errUnknown: "暂时无法保存，请重试。",
    managerOf: "的主管", empty: "暂无人员。",
  },
};

/** DB error text -> key of the area texts. */
export function approvalsErrorKey(message: string | undefined): K {
  const m = message ?? "";
  if (/NOT_AUTHORIZED/.test(m)) return "errNotAuthorized";
  if (/INVALID_PHONE/.test(m)) return "errInvalidPhone";
  if (/CONSENT_REQUIRED/.test(m)) return "errConsent";
  if (/INVALID_MANAGER|INVALID_INPUT/.test(m)) return "errInvalidManager";
  if (/NOT_FOUND/.test(m)) return "errNotFound";
  return "errUnknown";
}
