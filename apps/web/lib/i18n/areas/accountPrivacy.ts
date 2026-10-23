import type { AreaTexts } from "../areaText";

export type AccountPrivacyKey =
  | "pageTitle" | "pageSubtitle" | "download" | "exportNote" | "error" | "success" | "myRequests" | "loadFail" | "none"
  | "kAccess" | "kCorrection" | "kExport" | "kDeletion" | "oCorrection" | "response"
  | "newRequest" | "type" | "describe" | "legal" | "submit" | "editProfile";

export const accountPrivacyTexts: AreaTexts<AccountPrivacyKey> = {
  "pt-BR": {
    pageTitle: "Perfil e Privacidade", pageSubtitle: "Acompanhe solicitações relacionadas aos seus dados.",
    download: "Baixar meus dados em JSON",
    exportNote: "A exportação reúne seus registros estruturados. Fotos e arquivos binários não são incluídos neste JSON; seus documentos continuam nos acessos autenticados correspondentes.",
    error: "Não foi possível registrar a solicitação. Confira os dados e tente novamente.",
    success: "Solicitação registrada. Acompanhe o tratamento abaixo.",
    myRequests: "Minhas solicitações", loadFail: "Não foi possível consultar suas solicitações.", none: "Nenhuma solicitação enviada.",
    kAccess: "Acesso aos dados", kCorrection: "Correção", kExport: "Exportação", kDeletion: "Exclusão", oCorrection: "Correção de dados",
    response: "Resposta: {r}", newRequest: "Nova solicitação", type: "Tipo", describe: "Descreva sua solicitação",
    legal: "Pedidos são analisados conforme finalidade, base legal e retenção aplicável. O envio não apaga automaticamente históricos operacionais.",
    submit: "Enviar solicitação", editProfile: "Editar meus dados de perfil →",
  },
  "en-US": {
    pageTitle: "Profile and Privacy", pageSubtitle: "Track requests related to your data.",
    download: "Download my data as JSON",
    exportNote: "The export gathers your structured records. Photos and binary files are not included in this JSON; your documents remain available through their respective authenticated access.",
    error: "The request could not be recorded. Check the data and try again.",
    success: "Request recorded. Follow its handling below.",
    myRequests: "My requests", loadFail: "Your requests could not be retrieved.", none: "No requests submitted.",
    kAccess: "Data access", kCorrection: "Correction", kExport: "Export", kDeletion: "Deletion", oCorrection: "Data correction",
    response: "Response: {r}", newRequest: "New request", type: "Type", describe: "Describe your request",
    legal: "Requests are reviewed according to purpose, legal basis and applicable retention. Submitting does not automatically erase operational history.",
    submit: "Submit request", editProfile: "Edit my profile data →",
  },
  es: {
    pageTitle: "Perfil y Privacidad", pageSubtitle: "Siga las solicitudes relacionadas con sus datos.",
    download: "Descargar mis datos en JSON",
    exportNote: "La exportación reúne sus registros estructurados. Las fotos y los archivos binarios no se incluyen en este JSON; sus documentos siguen disponibles en los accesos autenticados correspondientes.",
    error: "No fue posible registrar la solicitud. Verifique los datos e inténtelo de nuevo.",
    success: "Solicitud registrada. Siga su tratamiento a continuación.",
    myRequests: "Mis solicitudes", loadFail: "No fue posible consultar sus solicitudes.", none: "Ninguna solicitud enviada.",
    kAccess: "Acceso a los datos", kCorrection: "Corrección", kExport: "Exportación", kDeletion: "Eliminación", oCorrection: "Corrección de datos",
    response: "Respuesta: {r}", newRequest: "Nueva solicitud", type: "Tipo", describe: "Describa su solicitud",
    legal: "Las solicitudes se analizan según la finalidad, la base legal y la retención aplicable. El envío no elimina automáticamente los historiales operativos.",
    submit: "Enviar solicitud", editProfile: "Editar mis datos de perfil →",
  },
  "zh-CN": {
    pageTitle: "个人资料与隐私", pageSubtitle: "跟踪与您的数据相关的申请。",
    download: "以 JSON 下载我的数据",
    exportNote: "导出内容汇总您的结构化记录。照片和二进制文件不包含在此 JSON 中；您的文档仍可通过相应的已验证访问获取。",
    error: "无法记录该申请。请检查数据后重试。",
    success: "申请已记录。请在下方跟踪处理进度。",
    myRequests: "我的申请", loadFail: "无法查询您的申请。", none: "尚未提交任何申请。",
    kAccess: "数据访问", kCorrection: "更正", kExport: "导出", kDeletion: "删除", oCorrection: "数据更正",
    response: "回复：{r}", newRequest: "新申请", type: "类型", describe: "请描述您的申请",
    legal: "申请将根据目的、法律依据和适用的保留期限进行审核。提交申请不会自动删除运营历史记录。",
    submit: "提交申请", editProfile: "编辑我的个人资料 →",
  },
};
