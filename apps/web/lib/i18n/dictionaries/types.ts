import type { FuelLevelValue, VehicleColorValue } from "@/lib/domain/vehicleFieldOptions";

/** Vehicle status enum values (Database["public"]["Enums"]["vehicle_status"]). */
export type VehicleStatusKey =
  | "available"
  | "reserved"
  | "awaiting_pickup"
  | "in_use"
  | "returning"
  | "inspection"
  | "charging"
  | "cleaning"
  | "maintenance"
  | "blocked";

/**
 * Exact pt-BR `notifications.title` literals written by the SECURITY DEFINER RPCs in
 * supabase/migrations (0008, 0010, 0015, 0017, 0018, 0020, 0021), plus the two written
 * directly by lib/domain/autoReassignment.ts. Closed set: adding a new title in
 * SQL without adding it here degrades gracefully to the raw pt-BR string.
 */
export type KnownNotificationTitle =
  | "Nova reserva aguardando aprovação"
  | "Reserva aprovada"
  | "Reserva cancelada"
  | "Novas tarefas operacionais"
  | "Veículo bloqueado"
  | "Sua próxima reserva pode ser afetada"
  | "Reserva marcada como impactada"
  | "Veículo reatribuído automaticamente"
  | "Seu pedido de veículo não pôde ser atendido"
  | "Pedido de carona na sua viagem"
  | "Carona aceita"
  | "Carona recusada"
  | "Nova mensagem na reserva";

/** Exact pt-BR `notifications.body` literals that carry no interpolated data. */
export type KnownNotificationBody =
  | "Sua reserva foi aprovada e o veículo está confirmado."
  | "Sua reserva foi cancelada."
  | "Uma devolução de veículo gerou novas tarefas operacionais."
  | "Um veículo foi bloqueado."
  | "Um atraso na viagem anterior deste veículo pode afetar o horário da sua reserva."
  | "Um atraso na viagem anterior deste veículo pode afetar o horário da sua reserva. Buscando um veículo alternativo automaticamente."
  | "Um atraso pode afetar a próxima reserva deste veículo — avalie reatribuição."
  | "Um atraso pode afetar a próxima reserva deste veículo — o sistema tentará reatribuir automaticamente."
  | "Um atraso na reserva anterior deste veículo afeta o horário da sua viagem, e não encontramos outro veículo disponível agora. O gestor de frota já foi avisado para resolver manualmente.";

export type Dictionary = {
  /** Shared UI chrome reused across many screens (buttons, table headers, generic labels). */
  common: {
    save: string;
    saving: string;
    saveChanges: string;
    cancel: string;
    edit: string;
    delete: string;
    deleting: string;
    remove: string;
    confirm: string;
    add: string;
    adding: string;
    close: string;
    back: string;
    loading: string;
    sending: string;
    retry: string;
    none: string;
    all: string;
    yes: string;
    no: string;
    optional: string;
    required: string;
    actions: string;
    status: string;
    name: string;
    notes: string;
    details: string;
    viewDetails: string;
    search: string;
    filters: string;
    approve: string;
    reject: string;
    date: string;
    time: string;
    vehicle: string;
    driver: string;
    destination: string;
    showPassword: string;
    hidePassword: string;
    openMenu: string;
    closeMenu: string;
  };
  /** Localized vehicle status + attention-reason labels (see dashboard/statusMeta.ts). */
  status: {
    vehicle: Record<VehicleStatusKey, string>;
    attention: {
      damage_blocking_trip: string;
      safety_equipment_missing: string;
      documentation_invalid: string;
      maintenance_due_soon: string;
      energy_low: string;
      cleaning_required: string;
    };
  };
  /** Root error boundary (app/error.tsx). */
  appError: {
    title: string;
    description: string;
    code: string;
    retry: string;
  };
  /** Password recovery / reset flows + session recovery splash. */
  auth: {
    verifyingSession: string;
    forgotTitle: string;
    backToLogin: string;
    emailLabel: string;
    emailPlaceholder: string;
    sendResetLink: string;
    resetLinkSent: string;
    resetTitle: string;
    newPasswordLabel: string;
    newPasswordPlaceholder: string;
    confirmNewPasswordLabel: string;
    confirmNewPasswordPlaceholder: string;
    saveNewPassword: string;
  };
  nav: {
    dashboard: string;
    trips: string;
    gate: string;
    analytics: string;
    fleet: string;
    team: string;
    settings: string;
  };
  roles: {
    employee: string;
    fleet_manager: string;
    security: string;
    maintenance_operator: string;
    administrator: string;
  };
  chrome: {
    signOut: string;
    requestTrip: string;
    language: string;
    theme: string;
    appTitle: string;
    appDescription: string;
    /** Title/hover text on the user name block in the header, linking to /account. */
    accountLink: string;
    userMenu: {
      label: string;
      changePassword: string;
      personalData: string;
      license: string;
      signOut: string;
    };
    licensePendingNotice: string;
    licenseGateNotice: string;
  };
  /** Self-service "change my password" screen, reachable by any role from the header. */
  account: {
    title: string;
    description: string;
    forcedChangeNotice: string;
    newPasswordLabel: string;
    confirmNewPasswordLabel: string;
    submit: string;
    success: string;
    license: {
      title: string;
      description: string;
      capturePrompt: string;
      analyzing: string;
      noPhoto: string;
      notAnImage: string;
      photoTooLarge: string;
      analysisFailed: string;
      saveFailed: string;
      unreadable: string;
      unreadableRetry: string;
      unreadableGiveUp: string;
      reviewPrompt: string;
      successValid: string;
      successExpired: string;
      readFields: {
        fullName: string;
        number: string;
        category: string;
        expirationDate: string;
      };
      redo: string;
      confirmReadCheckbox: string;
      read: string;
      submit: string;
    };
    profile: {
      title: string;
      nameLabel: string;
      nameFromLicenseHint: string;
      emailLabel: string;
      emailImmutableHint: string;
      nameRequired: string;
      licenseSectionTitle: string;
      changeAvatar: string;
      avatarTooLarge: string;
      avatarNotAnImage: string;
      saveFailed: string;
      success: string;
      submit: string;
    };
  };
  login: {
    tagline: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    forgotPassword: string;
    submit: string;
    submitPending: string;
    noAccount: string;
    createAccount: string;
  };
  signup: {
    tagline: string;
    fullNameLabel: string;
    fullNamePlaceholder: string;
    emailLabel: string;
    emailPlaceholder: string;
    passwordLabel: string;
    passwordPlaceholder: string;
    confirmPasswordLabel: string;
    confirmPasswordPlaceholder: string;
    passwordMismatch: string;
    submit: string;
    submitPending: string;
    haveAccount: string;
    signIn: string;
  };
  /** Dashboard screen (app/dashboard/page.tsx + EnergyGauge.tsx). */
  dashboard: {
    /** Banner shown when a fleet server action fails (?fleetActionError). */
    actionError: string;
    /** Banner shown when a fleet server action succeeds (?actionSuccess). */
    actionSuccess: string;
    /** Dismiss link on both the error and success banners. */
    dismissBanner: string;
    /**
     * Reason strings passed to cancelReservation when a fleet manager rejects/cancels
     * from the dashboard (as opposed to a manager-typed free-text reason). Sourced from
     * the dict rather than hardcoded pt-BR so the stored/notified reason reflects the
     * acting manager's own locale, like any other manager-authored text.
     */
    cancelReasons: {
      rejectedByManager: string;
      cancelledByManager: string;
    };
    attention: {
      heading: string;
      empty: string;
    };
    pendingReservations: {
      heading: string;
      empty: string;
      /** {count} — number of passengers on the trip request. */
      passengers: string;
      /** Prefix before the expected return timestamp. */
      returnBy: string;
      /** Prefix before the (possibly truncated) justification text. */
      justification: string;
      noJustification: string;
      /** Tooltip/label on the link opening the full reservation. */
      openReservation: string;
      /** {name} — the requester's full name. */
      confirmApprove: string;
      confirmReject: string;
      /** Placeholder on the inline free-text rejection reason input. */
      reasonPlaceholder: string;
      reasonLabel: string;
      /** Shown instead of the Approve button when the vehicle is currently
       * maintenance/blocked — approve_reservation would reject it anyway. */
      vehicleUnavailable: string;
      vehicleUnavailableHint: string;
    };
    activeReservations: {
      heading: string;
      empty: string;
      routeColumn: string;
      requesterColumn: string;
      departureColumn: string;
      swapColumn: string;
      transferColumn: string;
      statusConfirmed: string;
      statusPending: string;
      impacted: string;
      messages: string;
      noVehicleAvailable: string;
      selectPlaceholder: string;
      swapAction: string;
      transferAction: string;
      /** {name} — the requester's full name, or `unknownRequester`. */
      confirmCancel: string;
      unknownRequester: string;
      confirmSwap: string;
      confirmTransfer: string;
    };
    tasks: {
      heading: string;
      empty: string;
      complete: string;
      confirmCancel: string;
      confirmComplete: string;
      /** "My tasks" / "All" filter toggle over the open-task queue. */
      filterMine: string;
      filterAll: string;
      /** Empty state while the "my tasks" filter is active. */
      emptyMine: string;
      claim: string;
      confirmClaim: string;
      claiming: string;
      /** {name} — the assignee's full name. */
      assignedTo: string;
      unassigned: string;
      /** Shown instead of `unassigned` when a task IS assigned but the assignee's
       * profile join came back empty — distinct so it doesn't read as "no one has this". */
      assigneeNameUnavailable: string;
      priorityLabel: string;
      priorities: {
        low: string;
        normal: string;
        high: string;
      };
      types: {
        repair: string;
        safety: string;
        preventive_maintenance: string;
        cleaning: string;
        fuel: string;
        charging: string;
      };
    };
    vehicles: {
      heading: string;
      loadError: string;
      emptyLead: string;
      emptyManagerCta: string;
      emptyEmployeeHint: string;
      energy: string;
      fuel: string;
      battery: string;
      odometer: string;
      currentLocation: string;
      /** Suffix appended after the percentage for battery-powered vehicles. */
      batterySuffix: string;
      unblock: string;
      block: string;
      /** {plate} — the vehicle's plate. */
      confirmBlock: string;
      confirmUnblock: string;
      /** Inline free-text block reason: placeholder and the fallback used when empty. */
      blockReasonPlaceholder: string;
      blockReasonLabel: string;
      blockReasonDefault: string;
    };
  };
  /** Notification bell dropdown (app/dashboard/NotificationBell.tsx). */
  notifications: {
    label: string;
    /** {count} — number of unread notifications. */
    ariaUnread: string;
    licensePendingAria: string;
    licensePendingTitle: string;
    licensePendingBody: string;
    markAllRead: string;
    loadError: string;
    empty: string;
    /** Relative timestamps; {count} is the whole-number amount. */
    relative: {
      now: string;
      minutes: string;
      hours: string;
      days: string;
    };
    /**
     * In-app notification rows are written in pt-BR by SECURITY DEFINER RPCs
     * (0008/0010/0015/0017/0018 migrations) and stored that way. Unlike outbound email
     * (recipient locale unknown at send time), the reader of the bell IS the current
     * viewer, so the render layer translates the closed set of known titles here,
     * keyed by the exact pt-BR literal, with a fallback to the raw value.
     */
    knownTitles: Record<KnownNotificationTitle, string>;
    /**
     * Bodies that are fixed literals (no interpolated data), keyed by the exact pt-BR
     * string. Bodies carrying interpolated data (destination, block/cancel reason) are
     * handled by `bodyPrefixes` instead.
     */
    knownBodies: Record<KnownNotificationBody, string>;
    /**
     * Bodies the RPC concatenates from a fixed frame plus runtime data. The raw pt-BR
     * frame is matched in NotificationBell.tsx; the extracted value ({destination} /
     * {reason}) is re-inserted verbatim, since it is user-entered text we can't
     * translate.
     */
    bodyTemplates: {
      newReservationAwaitingApproval: string;
      vehicleBlockedReason: string;
      reservationCancelledReason: string;
      autoReassignedToVehicle: string;
      carpoolRequestReceived: string;
      carpoolAccepted: string;
      carpoolRejected: string;
    };
  };
  /** Fleet setup screens: vehicles, categories, locations and the vehicle schedule. */
  fleet: {
    title: string;
    loadError: string;
    tabs: {
      vehicles: string;
      categories: string;
      locations: string;
    };
    empty: {
      vehicles: string;
      categories: string;
      locations: string;
    };
    /** Client-side search/filter controls above the vehicle card grid. */
    filters: {
      searchPlaceholder: string;
      statusAll: string;
      categoryAll: string;
      clear: string;
      /** {shown} = matches, {total} = total vehicles. */
      resultCount: string;
      noMatches: string;
    };
    /** Empty-state lead line + hint pointing at the "+ Adicionar ..." button below. */
    emptyState: {
      vehiclesLead: string;
      vehiclesHint: string;
      categoriesLead: string;
      categoriesHint: string;
      locationsLead: string;
      locationsHint: string;
    };
    addVehicle: { label: string };
    addCategory: { label: string };
    addLocation: { label: string };
    vehicleForm: {
      prerequisite: string;
      plateLabel: string;
      platePlaceholder: string;
      namePlaceholder: string;
      colorLabel: string;
      colorCurrent: string;
      photoLabel: string;
      changePhotoLabel: string;
      photoAlt: string;
      categoryLabel: string;
      selectPlaceholder: string;
      odometerLabel: string;
      nextServiceLabel: string;
      estimatedRangeLabel: string;
      fuelLabel: string;
      fuelCurrent: string;
      batteryLabel: string;
      initialLocationLabel: string;
      homeLocationLabel: string;
      statusNote: string;
      /** Keyed by the stable numeric fuel-gauge values (see FUEL_LEVEL_OPTIONS). */
      fuelLevels: Record<`${FuelLevelValue}`, string>;
      /** Keyed by the stable stored color values (see VEHICLE_COLOR_OPTIONS). */
      colors: Record<VehicleColorValue, string>;
    };
    vehicleRow: {
      odometer: string;
      location: string;
      color: string;
      viewSchedule: string;
      deleteConfirm: string;
    };
    categoryForm: {
      namePlaceholder: string;
      passengersLabel: string;
      cargoLabel: string;
      energyLabel: string;
    };
    categories: {
      energy: {
        ICE: string;
        HEV: string;
        PHEV: string;
        BEV: string;
      };
      passengers: string;
      cargoSuffix: string;
      deleteConfirm: string;
    };
    locations: {
      newLabel: string;
      placeholder: string;
      deleteConfirm: string;
    };
    detail: {
      title: string;
      backToFleet: string;
      scheduleHeading: string;
      empty: string;
      nowMarker: string;
      impacted: string;
      reservationStatus: {
        pending_approval: string;
        confirmed: string;
        cancelled: string;
        completed: string;
      };
    };
  };
  /** "Minhas Viagens" list + carpools, and the trip request / recommendation flow. */
  trips: {
    list: {
      title: string;
      newTrip: string;
      actionError: string;
      empty: string;
      messages: string;
      startPickup: string;
      registerReturn: string;
      confirmCancel: string;
      impactedByDelay: string;
      carpoolsTitle: string;
      awaitingDriverAcceptance: string;
      leave: string;
      confirmLeave: string;
    };
    /** Reservation/trip status labels (distinct from vehicle status). */
    statuses: {
      pending_approval: string;
      confirmed: string;
      cancelled: string;
      completed: string;
    };
    request: {
      title: string;
      subtitle: string;
      departureLabel: string;
      expectedReturnLabel: string;
      originLabel: string;
      destinationLabel: string;
      destinationPlaceholder: string;
      distanceLabel: string;
      passengersLabel: string;
      cargoLabel: string;
      justificationLabel: string;
      submit: string;
      submitPending: string;
      recommendationTitle: string;
      emptyState: string;
      planError: string;
      carpoolAvailable: string;
      carpoolsCompatible: string;
      carpoolMatchNote: string;
      carpoolSchedule: string;
      confirming: string;
      acceptCarpool: string;
      recommendedVehicle: string;
      requestReservation: string;
      preparationNote: string;
      trafficRestrictionTitle: string;
      trafficRestrictionBody: string;
      otherEligibleVehicles: string;
      preferAnotherVehicle: string;
      choose: string;
      noOptions: string;
      reservationConflict: string;
      planChanged: string;
      confirmError: string;
    };
    /** Mobility Decision Engine reason codes shown under a recommendation. */
    reasons: {
      compatible_trip_found: string;
      passenger_capacity_sufficient: string;
      cargo_capable: string;
      energy_insufficient: string;
      cleaning_required: string;
      no_candidates_available: string;
      no_eligible_vehicle_for_trip_requirements: string;
      traffic_restriction_active: string;
    };
  };
  /** Fleet Intelligence screen (/analytics). */
  analytics: {
    title: string;
    loadError: string;
    units: {
      km: string;
    };
    underutilized: {
      title: string;
      empty: string;
      noCompletedTrips: string;
    };
    maintenance: {
      title: string;
      empty: string;
      overdue: string;
      estimatedOne: string;
      estimatedOther: string;
      kmPerDay: string;
      note: string;
    };
    utilization: {
      title: string;
      empty: string;
      colPlate: string;
      colCompletedTrips: string;
      colKm: string;
      colReadings: string;
      insufficientData: string;
    };
    kmPerTrip: {
      title: string;
      empty: string;
      average: string;
      tripsCountOne: string;
      tripsCountOther: string;
      colKm: string;
    };
    destinations: {
      title: string;
      empty: string;
      unitOne: string;
      unitOther: string;
    };
    carpooling: {
      title: string;
      empty: string;
      rateLabel: string;
      summary: string;
      carpoolsCountOne: string;
      carpoolsCountOther: string;
      requestsCountOne: string;
      requestsCountOther: string;
    };
  };
  /** Organization settings screen (app/settings). */
  settings: {
    title: string;
    safetyEquipment: {
      heading: string;
      description: string;
      nameLabel: string;
      namePlaceholder: string;
      addButton: string;
    };
    chatUsage: {
      title: string;
      conversations7d: string;
      messagesToday: string;
      resolved: string;
      abandoned: string;
      topIntents: string;
    };
    form: {
      range: {
        heading: string;
        description: string;
        safetyBufferLabel: string;
        minChargeHoursBevLabel: string;
        minRefuelHoursLabel: string;
        minCleaningHoursLabel: string;
      };
      carpool: {
        heading: string;
        description: string;
        departureToleranceLabel: string;
        returnToleranceLabel: string;
      };
      booking: {
        heading: string;
        description: string;
        modes: {
          ai_recommended: { label: string; hint: string };
          hybrid: { label: string; hint: string };
          user_choice: { label: string; hint: string };
        };
      };
      maintenance: {
        heading: string;
        description: string;
        dueSoonKmLabel: string;
        trafficRestrictionLabel: string;
      };
      earlyPickup: {
        heading: string;
        description: string;
        graceMinutesLabel: string;
      };
      submit: string;
      success: string;
      errors: {
        generic: string;
        not_authenticated: string;
        not_authorized: string;
        invalid_values: string;
      };
    };
  };
  /** Team / user management screen (app/settings/users). */
  team: {
    title: string;
    loadError: string;
    /** {count} = number of members. */
    membersHeading: string;
    columns: {
      member: string;
      role: string;
      authorized: string;
      license: string;
      action: string;
    };
    /** {roles} = the role labels joined with " · ". */
    rolesLegend: string;
    /** Client-side search above the member table. */
    search: {
      placeholder: string;
      /** {shown} = matches, {total} = total members. */
      resultCount: string;
      noMatches: string;
    };
    invite: {
      trigger: string;
      modalTitle: string;
      dialogLabel: string;
      nameLabel: string;
      namePlaceholder: string;
      emailLabel: string;
      emailPlaceholder: string;
      passwordLabel: string;
      passwordPlaceholder: string;
      roleLabel: string;
      passwordHint: string;
      submit: string;
      submitPending: string;
      success: string;
    };
    row: {
      savingShort: string;
      autoSaved: string;
      driverAuthorized: string;
      licenseNumberPlaceholder: string;
      licenseCategoryPlaceholder: string;
      removing: string;
      /** {name} = the member's full name. */
      removeConfirm: string;
    };
  };
  /** Reservation detail screen, message thread, photo capture and pickup/return checklists. */
  reservations: {
    detail: {
      title: string;
      backToTrips: string;
      impactedTitle: string;
      impactedDefaultReason: string;
      impactedReassignPrefix: string;
      impactedReassignLink: string;
      carpoolRequestsTitle: string;
      passengerCountOne: string;
      passengerCountOther: string;
      accept: string;
      decline: string;
      declineConfirm: string;
      communicationTitle: string;
      carpoolActionError: string;
    };
    messages: {
      empty: string;
      systemSender: string;
      types: {
        text: string;
        delay: string;
        vehicle_issue: string;
        return_time_change: string;
        vehicle_not_found: string;
        system_alert: string;
      };
      newReturnTimeLabel: string;
      newReturnTimeHint: string;
      bodyPlaceholder: string;
      send: string;
      sending: string;
    };
    photos: {
      legend: string;
      hint: string;
      tapToCapture: string;
      captured: string;
      capture: string;
      captureAnother: string;
      photoCount: string;
      upload: string;
      fileTooLarge: string;
      damageHint: string;
      takePhoto: string;
      openingCamera: string;
      cameraPermissionDenied: string;
      cameraNotFound: string;
      cameraGenericError: string;
      angles: {
        front: string;
        back: string;
        left_side: string;
        right_side: string;
        wheels: string;
        interior: string;
        damage: string;
      };
    };
    checklist: {
      electricRange: string;
      fuelLabel: string;
      batteryLabel: string;
      safetyEquipmentLegend: string;
      damageNotesPlaceholder: string;
      dirtyExterior: string;
      dirtyInterior: string;
      damagePhotoRequired: string;
      goToTrips: string;
      submitting: string;
    };
    pickup: {
      title: string;
      odometerLabel: string;
      hasDamage: string;
      submitError: string;
      submit: string;
      photosFailedOne: string;
      photosFailedOther: string;
    };
    return: {
      title: string;
      odometerLabel: string;
      odometerAtPickup: string;
      parkedWhereLabel: string;
      selectLocation: string;
      hasNewDamage: string;
      submitError: string;
      submit: string;
      photosFailedOne: string;
      photosFailedOther: string;
    };
    /**
     * Shown on /trips when the pickup/return checklist page itself refused to open,
     * via ?tripActionError=<reason> (see reservations/[id]/{pickup,return}/page.tsx).
     */
    checklistGuard: {
      notAuthorized: string;
      pickupWrongStatus: string;
      returnWrongStatus: string;
    };
  };
  /** User-facing error/validation messages returned by Server Actions. */
  errors: {
    /**
     * Bare codes Server Actions return instead of a message (they are not user text and
     * used to render literally, e.g. "not_authorized"). Resolved by
     * lib/i18n/errorLabel.ts, which passes anything else through unchanged — the rest of
     * the actions already return fully localized strings.
     */
    common: {
      generic: string;
      not_authorized: string;
      not_authenticated: string;
      no_profile: string;
    };
    auth: {
      missingEnvVarSignIn: string;
      invalidCredentials: string;
      signInFailed: string;
      emailAlreadyRegistered: string;
      userCreationFailed: string;
      profileCreationFailed: string;
      invalidInput: string;
      passwordMismatch: string;
      signinAfterSignupFailed: string;
      missingEnvVarSignUp: string;
      signUpFailed: string;
      missingEnvVarSigninAfterSignup: string;
      emailRequired: string;
      passwordTooShort: string;
      passwordUpdateFailed: string;
    };
    fleet: {
      photoMustBeImage: string;
      photoTooLarge: string;
      photoUploadFailed: string;
      locationNameRequired: string;
      locationInvalid: string;
      locationInUse: string;
      categoryNameAndCapacity: string;
      energyTypeRequired: string;
      categoryInvalid: string;
      categoryInUse: string;
      vehicleRequiredFields: string;
      odometerInvalid: string;
      nextServiceOdometerInvalid: string;
      estimatedRangeInvalid: string;
      fuelLevelRange: string;
      batteryLevelRange: string;
      categoryOrLocationInvalid: string;
      duplicatePlate: string;
      vehicleCreateFailed: string;
      vehicleInvalid: string;
      vehicleHasHistory: string;
    };
    users: {
      inviteRequiredFields: string;
      roleInvalid: string;
      emailAlreadyRegistered: string;
      userCreateFailed: string;
      profileCreateFailed: string;
      selectionInvalid: string;
      lastAdministrator: string;
      userNotFound: string;
      userInvalid: string;
      cannotRemoveSelf: string;
      driverAuthorizationSaveFailed: string;
      removeUserFailed: string;
    };
    reservations: {
      reservationInvalid: string;
      messageRequired: string;
      messageTypeInvalid: string;
      driverNotAuthorized: string;
      licenseExpired: string;
      earlyPickupNotAllowed: string;
    };
  };
  /** /gate — portaria (gatehouse) movements board. */
  gate: {
    title: string;
    description: string;
    searchLabel: string;
    searchPlaceholder: string;
    empty: string;
    noResults: string;
    details: string;
    pickupAction: string;
    returnAction: string;
    loadError: string;
  };
  /** Global conversational assistant (ChatWidget/ChatPanel) — floating entry point on
   * every authenticated screen. */
  chat: {
    fabLabel: string;
    voiceHint: string;
    panelTitle: string;
    emptyStateHint: string;
    inputPlaceholder: string;
    send: string;
    micStart: string;
    micStop: string;
    micListening: string;
    micPermissionDenied: string;
    micGenericError: string;
    confirmYes: string;
    confirmCancel: string;
    errorGeneric: string;
    thinking: string;
  };
};
