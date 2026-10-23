import type { AreaTexts } from "../areaText";
import type { Locale } from "../locales";

export type SettingsMiscKey =
  | "orgWideNotice" | "backToFleet" | "deactivate"
  | "accessInvalid" | "accessNotAuthorized" | "accessNotFound" | "accessSelf"
  | "accessConcurrent" | "accessLastAdmin" | "accessIdempotency" | "accessFailed";

const ACCESS_KEYS = [
  "accessInvalid", "accessNotAuthorized", "accessNotFound", "accessSelf",
  "accessConcurrent", "accessLastAdmin", "accessIdempotency", "accessFailed",
] as const satisfies readonly SettingsMiscKey[];

/** settings/users/actions.ts (changeMemberAccess) returns these messages in pt-BR; the UI re-localizes the known ones. */
export function accessErrorText(locale: Locale, message: string | undefined): string | null {
  const pt = settingsMiscTexts["pt-BR"];
  const key = ACCESS_KEYS.find((k) => pt[k] === message);
  return key ? (settingsMiscTexts[locale] ?? pt)[key] : null;
}

export const settingsMiscTexts: AreaTexts<SettingsMiscKey> = {
  "pt-BR": {
    orgWideNotice: "As configurações e métricas desta página abrangem toda a organização. Seu acesso de gestão é por unidade ou não pôde ser confirmado. Solicite as alterações globais ao administrador.",
    backToFleet: "Voltar à frota autorizada",
    deactivate: "Desativar",
    accessInvalid: "Confira o usuário, a versão e a justificativa.",
    accessNotAuthorized: "Seu perfil não pode alterar este acesso.",
    accessNotFound: "Usuário não encontrado na sua organização.",
    accessSelf: "Você não pode desativar o próprio acesso.",
    accessConcurrent: "O acesso foi alterado. Recarregue a página antes de tentar novamente.",
    accessLastAdmin: "É necessário manter ao menos um administrador ativo.",
    accessIdempotency: "Recarregue a página para iniciar uma nova solicitação.",
    accessFailed: "Não foi possível alterar o acesso. Nenhuma conta foi excluída.",
  },
  "en-US": {
    orgWideNotice: "The settings and metrics on this page cover the whole organization. Your management access is per unit or could not be confirmed. Ask the administrator for global changes.",
    backToFleet: "Back to the authorized fleet",
    deactivate: "Deactivate",
    accessInvalid: "Check the user, the version and the justification.",
    accessNotAuthorized: "Your profile cannot change this access.",
    accessNotFound: "User not found in your organization.",
    accessSelf: "You cannot deactivate your own access.",
    accessConcurrent: "The access was changed. Reload the page before trying again.",
    accessLastAdmin: "At least one active administrator must be kept.",
    accessIdempotency: "Reload the page to start a new request.",
    accessFailed: "Could not change the access. No account was deleted.",
  },
  es: {
    orgWideNotice: "Las configuraciones y métricas de esta página abarcan toda la organización. Su acceso de gestión es por unidad o no pudo ser confirmado. Solicite los cambios globales al administrador.",
    backToFleet: "Volver a la flota autorizada",
    deactivate: "Desactivar",
    accessInvalid: "Revise el usuario, la versión y la justificación.",
    accessNotAuthorized: "Su perfil no puede modificar este acceso.",
    accessNotFound: "Usuario no encontrado en su organización.",
    accessSelf: "No puede desactivar su propio acceso.",
    accessConcurrent: "El acceso fue modificado. Recargue la página antes de intentarlo de nuevo.",
    accessLastAdmin: "Es necesario mantener al menos un administrador activo.",
    accessIdempotency: "Recargue la página para iniciar una nueva solicitud.",
    accessFailed: "No fue posible modificar el acceso. Ninguna cuenta fue eliminada.",
  },
  "zh-CN": {
    orgWideNotice: "此页面的设置和指标涵盖整个组织。您的管理权限按单位划分，或无法确认。请向管理员申请全局更改。",
    backToFleet: "返回已授权的车队",
    deactivate: "停用",
    accessInvalid: "请检查用户、版本和理由。",
    accessNotAuthorized: "您的角色无权更改此访问权限。",
    accessNotFound: "在您的组织中未找到该用户。",
    accessSelf: "您不能停用自己的访问权限。",
    accessConcurrent: "访问权限已被更改。请刷新页面后再试。",
    accessLastAdmin: "必须至少保留一名启用的管理员。",
    accessIdempotency: "请刷新页面以发起新的请求。",
    accessFailed: "无法更改访问权限。未删除任何账户。",
  },
};
