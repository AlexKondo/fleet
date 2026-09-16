import type { Dictionary } from "./types";

const dict: Dictionary = {
  nav: {
    dashboard: "Panel",
    trips: "Mis Viajes",
    analytics: "Analítica",
    fleet: "Flota",
    team: "Equipo",
    settings: "Configuración",
  },
  roles: {
    employee: "Colaborador",
    fleet_manager: "Gestor de Flota",
    security: "Seguridad / Portería",
    maintenance_operator: "Mantenimiento",
    administrator: "Administrador",
  },
  chrome: {
    signOut: "Salir",
    requestTrip: "+ Solicitar Viaje",
    language: "Idioma",
    theme: "Tema",
  },
  login: {
    tagline: "Right Vehicle. Right Trip. Ready to Go.",
    emailLabel: "Correo electrónico",
    emailPlaceholder: "gestor@gwm-demo.local",
    passwordLabel: "Contraseña",
    passwordPlaceholder: "••••••••••••",
    forgotPassword: "Olvidé mi contraseña",
    submit: "Entrar",
    submitPending: "Entrando…",
    noAccount: "¿Tu empresa aún no usa Fleet?",
    createAccount: "Crear cuenta",
  },
  signup: {
    tagline: "Empieza a operar tu flota",
    fullNameLabel: "Tu nombre completo",
    fullNamePlaceholder: "Maria Silva",
    emailLabel: "Correo electrónico",
    emailPlaceholder: "tu@tuempresa.com",
    passwordLabel: "Contraseña",
    passwordPlaceholder: "Mínimo 8 caracteres",
    confirmPasswordLabel: "Confirmar contraseña",
    confirmPasswordPlaceholder: "Escribe la contraseña de nuevo",
    passwordMismatch: "Las contraseñas no coinciden.",
    submit: "Crear cuenta",
    submitPending: "Creando…",
    haveAccount: "¿Ya tienes una cuenta?",
    signIn: "Entrar",
  },
};

export default dict;
