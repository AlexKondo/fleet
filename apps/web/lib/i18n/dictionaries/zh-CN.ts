import type { Dictionary } from "./types";

const dict: Dictionary = {
  nav: {
    dashboard: "仪表盘",
    trips: "我的行程",
    analytics: "数据分析",
    fleet: "车队",
    team: "团队",
    settings: "设置",
  },
  roles: {
    employee: "员工",
    fleet_manager: "车队经理",
    security: "安保 / 门岗",
    maintenance_operator: "维护人员",
    administrator: "管理员",
  },
  chrome: {
    signOut: "退出登录",
    requestTrip: "+ 申请行程",
    language: "语言",
    theme: "主题",
  },
  login: {
    tagline: "Right Vehicle. Right Trip. Ready to Go.",
    emailLabel: "邮箱",
    emailPlaceholder: "gestor@gwm-demo.local",
    passwordLabel: "密码",
    passwordPlaceholder: "••••••••••••",
    forgotPassword: "忘记密码",
    submit: "登录",
    submitPending: "登录中…",
    noAccount: "您的公司还没有使用 Fleet？",
    createAccount: "创建账户",
  },
  signup: {
    tagline: "开始管理您的车队",
    fullNameLabel: "您的全名",
    fullNamePlaceholder: "Maria Silva",
    emailLabel: "邮箱",
    emailPlaceholder: "you@yourcompany.com",
    passwordLabel: "密码",
    passwordPlaceholder: "至少 8 个字符",
    confirmPasswordLabel: "确认密码",
    confirmPasswordPlaceholder: "请再次输入密码",
    passwordMismatch: "两次输入的密码不一致。",
    submit: "创建账户",
    submitPending: "创建中…",
    haveAccount: "已经有账户了？",
    signIn: "登录",
  },
};

export default dict;
