import type { Dictionary } from "./types";

const dict: Dictionary = {
  nav: {
    dashboard: "Painel",
    trips: "Minhas Viagens",
    analytics: "Analytics",
    fleet: "Frota",
    team: "Equipe",
    settings: "Configurações",
  },
  roles: {
    employee: "Colaborador",
    fleet_manager: "Gestor de Frota",
    security: "Segurança / Portaria",
    maintenance_operator: "Manutenção",
    administrator: "Administrador",
  },
  chrome: {
    signOut: "Sair",
    requestTrip: "+ Solicitar Viagem",
    language: "Idioma",
    theme: "Tema",
  },
  login: {
    tagline: "Right Vehicle. Right Trip. Ready to Go.",
    emailLabel: "E-mail",
    emailPlaceholder: "gestor@gwm-demo.local",
    passwordLabel: "Senha",
    passwordPlaceholder: "••••••••••••",
    forgotPassword: "Esqueci minha senha",
    submit: "Entrar",
    submitPending: "Entrando…",
    noAccount: "Sua empresa ainda não usa o Fleet?",
    createAccount: "Criar conta",
  },
  signup: {
    tagline: "Comece a operar sua frota",
    fullNameLabel: "Seu nome completo",
    fullNamePlaceholder: "Maria Silva",
    emailLabel: "E-mail",
    emailPlaceholder: "voce@suaempresa.com",
    passwordLabel: "Senha",
    passwordPlaceholder: "Mínimo 8 caracteres",
    confirmPasswordLabel: "Confirmar senha",
    confirmPasswordPlaceholder: "Digite a senha novamente",
    passwordMismatch: "As senhas não coincidem.",
    submit: "Criar conta",
    submitPending: "Criando…",
    haveAccount: "Já tem uma conta?",
    signIn: "Entrar",
  },
};

export default dict;
