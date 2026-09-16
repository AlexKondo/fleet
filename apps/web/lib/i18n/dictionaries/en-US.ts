import type { Dictionary } from "./types";

const dict: Dictionary = {
  nav: {
    dashboard: "Dashboard",
    trips: "My Trips",
    analytics: "Analytics",
    fleet: "Fleet",
    team: "Team",
    settings: "Settings",
  },
  roles: {
    employee: "Employee",
    fleet_manager: "Fleet Manager",
    security: "Security / Gate",
    maintenance_operator: "Maintenance",
    administrator: "Administrator",
  },
  chrome: {
    signOut: "Sign out",
    requestTrip: "+ Request Trip",
    language: "Language",
    theme: "Theme",
  },
  login: {
    tagline: "Right Vehicle. Right Trip. Ready to Go.",
    emailLabel: "Email",
    emailPlaceholder: "manager@gwm-demo.local",
    passwordLabel: "Password",
    passwordPlaceholder: "••••••••••••",
    forgotPassword: "Forgot my password",
    submit: "Sign in",
    submitPending: "Signing in…",
    noAccount: "Your company doesn't use Fleet yet?",
    createAccount: "Create account",
  },
  signup: {
    tagline: "Start operating your fleet",
    fullNameLabel: "Your full name",
    fullNamePlaceholder: "Maria Silva",
    emailLabel: "Email",
    emailPlaceholder: "you@yourcompany.com",
    passwordLabel: "Password",
    passwordPlaceholder: "Minimum 8 characters",
    confirmPasswordLabel: "Confirm password",
    confirmPasswordPlaceholder: "Type the password again",
    passwordMismatch: "Passwords don't match.",
    submit: "Create account",
    submitPending: "Creating…",
    haveAccount: "Already have an account?",
    signIn: "Sign in",
  },
};

export default dict;
