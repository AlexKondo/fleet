import type { AreaTexts } from "../areaText";

/** Screen /settings/approvals: direct manager of each person and the manager's WhatsApp number (approval by WhatsApp, migration 0229). */
type K =
  | "title" | "subtitle" | "howItWorks" | "channelOff" | "channelOn"
  | "colPerson" | "colRole" | "colManager" | "colWhatsapp" | "colStatus"
  | "noManager" | "whatsappPlaceholder" | "whatsappHint" | "consentLabel" | "save" | "saving" | "saved" | "fieldSaved"
  | "statusReady" | "statusNoManager" | "statusManagerNoPhone" | "statusIsManager"
  | "errNotAuthorized" | "errInvalidPhone" | "errConsent" | "errInvalidManager" | "errNotFound" | "errUnknown"
  | "managerOf" | "empty" | "emailNote" | "teamShortcut";

export const approvalsTexts: AreaTexts<K> = {
  "pt-BR": {
    title: "Aprovação por WhatsApp",
    subtitle: "Defina o gestor direto de cada pessoa. Quando alguém reservar um veículo, o gestor recebe o pedido por e-mail (sempre) e no WhatsApp (se tiver número cadastrado) e libera tocando em Aprovar.",
    howItWorks: "O gestor recebe: solicitante, veículo, data e hora de saída e de retorno, origem, destino e objetivo. Ao aprovar, o veículo é liberado; ao recusar, a reserva é cancelada e o solicitante é avisado. O pedido vale por até 24 horas. No e-mail, o botão abre uma página de confirmação (nada é decidido só por abrir). A aprovação dentro do sistema continua funcionando.",
    channelOff: "Nenhum canal de envio está ativo neste ambiente (falta configurar o e-mail e/ou o n8n do WhatsApp). Os cadastros abaixo já podem ser feitos.",
    channelOn: "Envio ativo. E-mail e/ou WhatsApp conforme a configuração do ambiente.",
    colPerson: "Pessoa", colRole: "Perfil", colManager: "Gestor direto", colWhatsapp: "WhatsApp (de quem aprova)", colStatus: "Situação",
    noManager: "Sem gestor direto",
    whatsappPlaceholder: "(11) 98765-4321",
    whatsappHint: "Com DDD. Deixe em branco para remover.",
    consentLabel: "Confirmo que esta pessoa concordou em receber pedidos de aprovação neste número",
    save: "Salvar", saving: "Salvando…", saved: "Salvo",
    fieldSaved: "O campo foi salvo",
    statusReady: "Pronto: o gestor recebe por e-mail e no WhatsApp",
    statusNoManager: "Sem gestor direto: aprovação só no sistema",
    statusManagerNoPhone: "O gestor recebe só por e-mail (sem WhatsApp cadastrado)",
    statusIsManager: "Gestor de {count} pessoa(s)",
    errNotAuthorized: "Somente administradores podem alterar este cadastro.",
    errInvalidPhone: "Número inválido. Use DDD + número, por exemplo (11) 98765-4321.",
    errConsent: "Marque a confirmação de que a pessoa concordou em receber os pedidos.",
    errInvalidManager: "Escolha um gestor ativo da mesma organização.",
    errNotFound: "Pessoa não encontrada.",
    errUnknown: "Não foi possível salvar agora. Tente novamente.",
    managerOf: "gestor de", empty: "Nenhuma pessoa cadastrada.",
    teamShortcut: "WhatsApp e aprovações",
    emailNote: "E-mail para pedidos: {email}",
  },
  "en-US": {
    title: "WhatsApp approval",
    subtitle: "Set each person's direct manager. When someone books a vehicle, the manager gets the request by e-mail (always) and on WhatsApp (if a number is registered) and releases it by tapping Approve.",
    howItWorks: "The manager receives: requester, vehicle, departure and return date and time, origin, destination and purpose. Approving releases the vehicle; rejecting cancels the booking and notifies the requester. A request is valid for up to 24 hours. In the e-mail, the button opens a confirmation page (nothing is decided just by opening it). Approving inside the system keeps working.",
    channelOff: "No sending channel is active in this environment yet (e-mail and/or the WhatsApp n8n still have to be configured). You can already fill in the records below.",
    channelOn: "Sending is active. E-mail and/or WhatsApp depending on the environment configuration.",
    colPerson: "Person", colRole: "Role", colManager: "Direct manager", colWhatsapp: "WhatsApp (of the approver)", colStatus: "Status",
    noManager: "No direct manager",
    whatsappPlaceholder: "(11) 98765-4321",
    whatsappHint: "With area code. Leave blank to remove.",
    consentLabel: "I confirm this person agreed to receive approval requests on this number",
    save: "Save", saving: "Saving…", saved: "Saved",
    fieldSaved: "The field was saved",
    statusReady: "Ready: the manager receives it by e-mail and on WhatsApp",
    statusNoManager: "No direct manager: approval only in the system",
    statusManagerNoPhone: "The manager receives it by e-mail only (no WhatsApp registered)",
    statusIsManager: "Manager of {count} person(s)",
    errNotAuthorized: "Only administrators can change this record.",
    errInvalidPhone: "Invalid number. Use area code + number, for example (11) 98765-4321.",
    errConsent: "Tick the confirmation that the person agreed to receive the requests.",
    errInvalidManager: "Choose an active manager from the same organization.",
    errNotFound: "Person not found.",
    errUnknown: "Could not save right now. Please try again.",
    managerOf: "manager of", empty: "No people registered.",
    teamShortcut: "WhatsApp and approvals",
    emailNote: "E-mail for requests: {email}",
  },
  es: {
    title: "Aprobación por WhatsApp",
    subtitle: "Define el gestor directo de cada persona. Cuando alguien reserve un vehículo, el gestor recibe la solicitud por correo (siempre) y por WhatsApp (si tiene número registrado) y la libera tocando Aprobar.",
    howItWorks: "El gestor recibe: solicitante, vehículo, fecha y hora de salida y de regreso, origen, destino y objetivo. Al aprobar, el vehículo se libera; al rechazar, la reserva se cancela y se avisa al solicitante. La solicitud vale hasta 24 horas. En el correo, el botón abre una página de confirmación (no se decide nada solo por abrirla). La aprobación dentro del sistema sigue funcionando.",
    channelOff: "Aún no hay ningún canal de envío activo en este entorno (falta configurar el correo y/o el n8n de WhatsApp). Ya puedes completar los registros.",
    channelOn: "Envío activo. Correo y/o WhatsApp según la configuración del entorno.",
    colPerson: "Persona", colRole: "Perfil", colManager: "Gestor directo", colWhatsapp: "WhatsApp (de quien aprueba)", colStatus: "Estado",
    noManager: "Sin gestor directo",
    whatsappPlaceholder: "(11) 98765-4321",
    whatsappHint: "Con código de área. Déjalo vacío para quitarlo.",
    consentLabel: "Confirmo que esta persona aceptó recibir solicitudes de aprobación en este número",
    save: "Guardar", saving: "Guardando…", saved: "Guardado",
    fieldSaved: "El campo fue guardado",
    statusReady: "Listo: el gestor lo recibe por correo y por WhatsApp",
    statusNoManager: "Sin gestor directo: aprobación solo en el sistema",
    statusManagerNoPhone: "El gestor lo recibe solo por correo (sin WhatsApp registrado)",
    statusIsManager: "Gestor de {count} persona(s)",
    errNotAuthorized: "Solo los administradores pueden cambiar este registro.",
    errInvalidPhone: "Número no válido. Usa código de área + número, por ejemplo (11) 98765-4321.",
    errConsent: "Marca la confirmación de que la persona aceptó recibir las solicitudes.",
    errInvalidManager: "Elige un gestor activo de la misma organización.",
    errNotFound: "Persona no encontrada.",
    errUnknown: "No se pudo guardar ahora. Inténtalo de nuevo.",
    managerOf: "gestor de", empty: "Ninguna persona registrada.",
    teamShortcut: "WhatsApp y aprobaciones",
    emailNote: "Correo para solicitudes: {email}",
  },
  "zh-CN": {
    title: "WhatsApp 审批",
    subtitle: "为每个人设置直属主管。有人预订车辆时，主管会通过电子邮件（始终）和 WhatsApp（如已登记号码）收到申请，点击“批准”即可放行。",
    howItWorks: "主管会收到：申请人、车辆、出发和返回的日期与时间、出发地、目的地和用途。批准后车辆放行；拒绝则取消预订并通知申请人。申请最长有效 24 小时。邮件中的按钮会打开确认页面（仅打开不会做出任何决定）。系统内的审批仍然可用。",
    channelOff: "此环境尚未启用任何发送渠道（还需配置电子邮件和/或 WhatsApp 的 n8n）。您可以先填写下方信息。",
    channelOn: "发送已启用。根据环境配置使用电子邮件和/或 WhatsApp。",
    colPerson: "人员", colRole: "角色", colManager: "直属主管", colWhatsapp: "WhatsApp（审批人）", colStatus: "状态",
    noManager: "无直属主管",
    whatsappPlaceholder: "(11) 98765-4321",
    whatsappHint: "含区号。留空则删除。",
    consentLabel: "我确认此人同意在该号码接收审批申请",
    save: "保存", saving: "保存中…", saved: "已保存",
    fieldSaved: "该字段已保存",
    statusReady: "已就绪：主管将通过电子邮件和 WhatsApp 收到",
    statusNoManager: "无直属主管：仅可在系统内审批",
    statusManagerNoPhone: "主管仅通过电子邮件收到（未登记 WhatsApp）",
    statusIsManager: "{count} 人的主管",
    errNotAuthorized: "只有管理员可以修改此记录。",
    errInvalidPhone: "号码无效。请填写区号加号码，例如 (11) 98765-4321。",
    errConsent: "请勾选确认：此人同意接收申请。",
    errInvalidManager: "请选择同一组织内的有效主管。",
    errNotFound: "未找到该人员。",
    errUnknown: "暂时无法保存，请重试。",
    managerOf: "的主管", empty: "暂无人员。",
    teamShortcut: "WhatsApp 与审批",
    emailNote: "接收申请的电子邮件：{email}",
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
