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
  | "Solicitação de carona expirada"
  | "Carona cancelada"
  | "Carona invalidada"
  | "Viagem do motorista alterada"
  | "Viagem com carona cancelada"
  | "Carona confirmada na sua viagem"
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
    todayPill: string;
    organizationLabel: string;
    resizeMenu: string;
    brandTagline: string;
    assistantTitle: string;
    assistantMic: string;
    assistantExamplesLabel: string;
    assistantExample1: string;
    assistantExample2: string;
    assistantExample3: string;
    assistantExample4: string;
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
      documentPreparationFailed: string;
      documentTooLargeAfterReduction: string;
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
    /** Employee Home (SCR-USR-001). */
    home: {
      navHome: string;
      greeting: string;
      greetingSub: string;
      quickActions: string;
      actionBook: string;
      actionBookHint: string;
      actionCarpool: string;
      actionCarpoolHint: string;
      actionTrips: string;
      actionTripsHint: string;
      nextTitle: string;
      viewAll: string;
      nextEmpty: string;
      nextEmptyCta: string;
      viewDetails: string;
      alertAwaiting: string;
      carpoolTitle: string;
      usedTitle: string;
      usedCountOne: string;
      usedCountOther: string;
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
      returnColumn: string;
      overlapWarning: string;
      overlapBadge: string;
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
      carpoolRequestsGrouped: string;
      carpoolRequestExpired: string;
      carpoolCancelledByRider: string;
      carpoolCancelledByManagement: string;
      carpoolInvalidatedHostCancelled: string;
      carpoolInvalidatedHostChanged: string;
      carpoolInvalidatedOfferDisabled: string;
      hostTripChangedForRider: string;
      hostTripChangedForHost: string;
      hostTripCancelledForHost: string;
      carpoolJoinedHostTrip: string;
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
      odometerCorrectionReason: string;
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
      cancelReasonLabel: string;
      cancelReasonPlaceholder: string;
      cancelReasonRequired: string;
      cancelManagerNote: string;
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
      departureLabel: string;
      expectedReturnLabel: string;
      originLabel: string;
      destinationLabel: string;
      destinationPlaceholder: string;
      distanceLabel: string;
      passengersLabel: string;
      cargoLabel: string;
      allowCarpoolLabel: string;
      justificationLabel: string;
      submit: string;
      submitPending: string;
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
      overlapTitle: string;
      overlapBody: string;
      overlapStatusPending: string;
      overlapStatusConfirmed: string;
      overlapQuestion: string;
      overlapKeep: string;
      overlapCancelPrevious: string;
      overlapReasonLabel: string;
      overlapReasonPlaceholder: string;
      overlapReasonRequired: string;
      overlapManagerNote: string;
      overlapConfirmCancel: string;
      overlapBack: string;
      overlapCancelling: string;
    };
    /** Minhas Reservas e Viagens (SCR-USR-004). */
    minhas: {
      title: string;
      subtitle: string;
      newReservation: string;
      tabsLabel: string;
      tabAll: string;
      tabUpcoming: string;
      tabActive: string;
      tabCarpools: string;
      tabDone: string;
      tabCancelled: string;
      upcomingTitle: string;
      activeTitle: string;
      historyTitle: string;
      /** Badge: confirmed reservation whose window ended without any pickup (no-show). */
      notPickedUp: string;
      /** Badge: request whose window ended while still awaiting approval. */
      expiredUnapproved: string;
      scheduleTitle: string;
      kindVehicle: string;
      viewDetails: string;
      tabEmpty: string;
    };
    reservar: {
      title: string;
      subtitle: string;
      navBook: string;
      detailsTitle: string;
      stepsLabel: string;
      stepTrip: string;
      stepTripHint: string;
      stepVehicle: string;
      stepVehicleHint: string;
      stepCarpool: string;
      stepCarpoolHint: string;
      stepConfirm: string;
      stepConfirmHint: string;
      stepDone: string;
      stepCurrent: string;
      decreaseSeats: string;
      increaseSeats: string;
      resultTitle: string;
      departureDateLabel: string;
      departureTimeLabel: string;
      returnDateLabel: string;
      returnTimeLabel: string;
      reasonLabel: string;
      reasonMeeting: string;
      reasonClientVisit: string;
      reasonTraining: string;
      reasonDelivery: string;
      reasonMaintenance: string;
      reasonOther: string;
      reasonOtherLabel: string;
      reasonOtherPlaceholder: string;
      searchCarpoolLabel: string;
      searchCarpoolHint: string;
      distanceAuto: string;
      mapEmpty: string;
      pickupLocationLabel: string;
      leavingFrom: string;
      otherOriginButton: string;
      backToWorkLocation: string;
      pickupLocationPlaceholder: string;
      pickupLocationHint: string;
      pickupVehiclesNone: string;
      pickupVehiclesOne: string;
      pickupVehiclesMany: string;
      noVehiclesAtOriginTitle: string;
      noVehiclesAtOriginBody: string;
      unknownOriginBody: string;
      otherLocationsHeading: string;
      showOtherLocations: string;
      otherLocationsWarning: string;
      vehicleElsewhere: string;
      backToOriginOnly: string;
      carpoolsFoundTitle: string;
      carpoolsFoundHint: string;
      vehiclesTitle: string;
      vehiclesHint: string;
      filterLabel: string;
      filterAll: string;
      energyICE: string;
      energyHEV: string;
      energyPHEV: string;
      energyBEV: string;
      recommendedBadge: string;
      select: string;
      noVehiclesFiltered: string;
      seatsCount: string;
      fuelLevel: string;
      batteryLevel: string;
      rangeKm: string;
      odometerKm: string;
    };
    /** Mobility Decision Engine reason codes shown under a recommendation. */
    reasons: {
      compatible_trip_found: string;
      passenger_capacity_sufficient: string;
      cargo_capable: string;
      energy_insufficient: string;
      cleaning_required: string;
      no_candidates_available: string;
      no_vehicles_at_origin: string;
      origin_location_unknown: string;
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
  /** Carpool KPI / telemetry dashboard (/analytics/carpool), fleet_manager and administrator only. */
  carpoolKpi: {
    title: string;
    loadError: string;
    linkFromAnalytics: string;
    backToAnalytics: string;
    rangeLabel: string;
    range7: string;
    range30: string;
    range90: string;
    sectionSearch: string;
    sectionOffers: string;
    sectionRequests: string;
    sectionShared: string;
    sectionProvider: string;
    sectionDefinitions: string;
    tripsEvaluated: string;
    offersEvaluated: string;
    candidatesAfterPrefilter: string;
    preciseRouteCalls: string;
    compatibleMatches: string;
    outcomeMatches: string;
    outcomeNone: string;
    outcomeUnavailable: string;
    outcomeError: string;
    sourceWeb: string;
    sourceChat: string;
    offersEnabled: string;
    offersActiveNow: string;
    rideRequests: string;
    accepted: string;
    rejected: string;
    expired: string;
    cancelled: string;
    pending: string;
    invalidatedRequests: string;
    acceptanceRate: string;
    invalidationsAfterHostChange: string;
    completedSharedTrips: string;
    seatsShared: string;
    avoidedAllocations: string;
    avoidedKm: string;
    /** {factor} = road distance factor used by the estimate. */
    avoidedKmNote: string;
    requestsWithoutCoordinates: string;
    latencyAvg: string;
    latencyP95: string;
    searchesPerDay: string;
    colKind: string;
    colCalls: string;
    colErrors: string;
    colAvgLatency: string;
    colEstCost: string;
    totalRow: string;
    providerGeocode: string;
    providerPlaceSearch: string;
    providerRouting: string;
    costNote: string;
    noData: string;
    defSearch: string;
    defRequests: string;
    defShared: string;
    defAvoided: string;
    defProvider: string;
  };
  /** Team / user management screen (app/settings/users). */
  team: {
    title: string;
    loadError: string;
    /** Shown (and the license/authorization forms disabled) when list_member_licenses() fails: never submit blank license fields. */
    licenseLoadError: string;
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
      licenseNumberLabel: string;
      licenseCategoryLabel: string;
      licenseExpirationLabel: string;
      licenseSourceAi: string;
      licenseSourceManual: string;
      licenseSourceUnknown: string;
      licenseLockedHint: string;
      resetLicense: string;
      resetLicenseConfirm: string;
      resetLicenseWorking: string;
      resetLicenseSelfHint: string;
      resetLicenseReasonLabel: string;
      resetLicenseReasonPlaceholder: string;
      removing: string;
      /** {name} = the member's full name. */
      removeConfirm: string;
      deactivate: string;
      reactivate: string;
      reactivateConfirm: string;
      accountActive: string;
      workLocationLabel: string;
      workLocationNone: string;
      accountInactive: string;
      accessUnavailable: string;
      reasonLabel: string;
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
      fileTypeNotSupported: string;
      remove: string;
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
      sectionTrip: string;
      equipmentHint: string;
      sectionCondition: string;
      pickupIntro: string;
      returnIntro: string;
      routeLabel: string;
      electricRange: string;
      fuelLabel: string;
      batteryLabel: string;
      safetyEquipmentLegend: string;
      damageNotesPlaceholder: string;
      dirtyExterior: string;
      dirtyInterior: string;
      damagePhotoRequired: string;
      damagePhotoPendingSaved: string;
      pendingPhotosLink: string;
      evidenceDamagePhotoMissing: string;
      photoTypeNotSupported: string;
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
      photoPendingAfterCreate: string;
      photoLinkPending: string;
      photoTooLarge: string;
      photoUploadFailed: string;
      photoTypeNotSupported: string;
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
      licenseLockedByAi: string;
      licenseResetFailed: string;
      licenseResetSelf: string;
      licenseResetReasonInvalid: string;
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
    confirmEdit: string;
    editPrompt: string;
    confirmCancel: string;
    errorGeneric: string;
    /** No vehicle available for the requested window (engine reason codes are translated via trips.reasons). */
    noVehicle: {
      carpoolKept: string;
      openForm: string;
    };
    /** FIX-VENCIDAS/Assistente: plain-language replies (what happened / why / alternatives / how to continue). */
    replies: {
      what: { reservation: string; availability: string; cancel: string; view: string; message: string; extend: string; carpoolOffer: string; carpoolDisable: string; carpoolFind: string; carpoolRequest: string; carpoolRespond: string; carpoolCancel: string; generic: string; };
      why: { reservationConflict: string; maintenanceConflict: string; vehicleUnavailable: string; unitDisabled: string; license: string; outsideWindow: string; scopeDenied: string; permissionDenied: string; invalidData: string; concurrent: string; tripStarted: string; cancelNotAllowed: string; notFound: string; sessionExpired: string; providerOutage: string; notSupported: string; missingReturnTime: string; missingInfo: string; unexpected: string; rateLimited: string; dailyLimit: string; confirmationExpired: string; };
      alternatives: { reservation: string; availability: string; cancel: string; view: string; message: string; extend: string; carpoolOffer: string; carpoolDisable: string; carpoolFind: string; carpoolRequest: string; carpoolRespond: string; carpoolCancel: string; generic: string; };
      keptInForm: string;
      keptInChat: string;
      reenter: string;
      and: string;
      fleet: { intro: string; summary: string; empty: string; reservedOne: string; reservedOther: string; maintenanceOne: string; maintenanceOther: string; blockedOne: string; blockedOther: string; inUseOne: string; inUseOther: string; busyOne: string; busyOther: string; seatsOne: string; seatsOther: string; cargoOne: string; cargoOther: string; notReadyOne: string; notReadyOther: string; otherOne: string; otherOther: string; };
      success: { reservationCreated: string; carpoolJoined: string; cancelled: string; noActiveReservation: string; reservationInfo: string; messagePosted: string; returnTimeUpdated: string; vehicleAvailable: string; carpoolAvailable: string; };
      card: { vehicle: string; vehicleAt: string; chooseOption: string; };
      notAutomated: { change: string; differentVehicle: string; startTrip: string; endTrip: string; };
      placeChoose: string;
      addressAsk: string;
      originPick: string;
      /** {origin} = where the person leaves from (their work location), {list} = locations that DO have a vehicle. */
      originNone: string;
      assistantDisabled: string;
      policyUnavailable: string;
      notUnderstood: string;
      /** Asked before any cancellation is confirmed: the fleet manager is told, with this reason. */
      cancelAskReason: string;
      /** {reservation} = the person's existing reservation in the requested period. */
      reservationOverlap: string;
    };
    thinking: string;
    carpool: {
      askSeats: string;
      askOrigin: string;
      noHostTrip: string;
      chooseTrip: string;
      tripListItem: string;
      offerEnableSummary: string;
      offerUpdateSummary: string;
      offerEnableDone: string;
      offerUpdateDone: string;
      noActiveOffer: string;
      chooseOffer: string;
      disableSummary: string;
      disableDone: string;
      placesUnderstood: string;
      findNone: string;
      findOffers: string;
      optionLabel: string;
      noRecentSearch: string;
      pickOption: string;
      requestSummary: string;
      requestApprovalNote: string;
      noPendingRequests: string;
      noPendingForName: string;
      chooseRequest: string;
      requestListItem: string;
      acceptSummary: string;
      rejectSummary: string;
      acceptDone: string;
      rejectDone: string;
      noCancellableRequest: string;
      chooseCancel: string;
      cancelListItem: string;
      cancelSummary: string;
      cancelSummaryAccepted: string;
      cancelDone: string;
      seatsOne: string;
      seatsOther: string;
      carpoolFirstIntro: string;
      useVehicle: string;
      reservationOfferNote: string;
      reservationOfferPublished: string;
      reservationOfferFailed: string;
      confirmationNotPending: string;
      optionsGroupLabel: string;
    };
  };
  /** /settings/mobility-points — Corporate Mobility Points admin CRUD (Phase C2). */
  mobilityPoints: {
    title: string;
    description: string;
    empty: string;
    inactiveLabel: string;
    addHeading: string;
    nameLabel: string;
    addressLabel: string;
    latitudeLabel: string;
    longitudeLabel: string;
    categoryLabel: string;
    categoryPlaceholder: string;
    aliasesLabel: string;
    aliasesPlaceholder: string;
    addButton: string;
    deactivateAction: string;
    deleteAction: string;
    deleteConfirm: string;
  };
  carpool: {
    newTrip: {
      placesTitle: string;
      originLabel: string;
      destinationLabel: string;
      sourceMobilityPoint: string;
      confirmHint: string;
      offersTitle: string;
      offersIntro: string;
      cardDeparture: string;
      cardReturn: string;
      cardDetour: string;
      seatsOne: string;
      seatsOther: string;
      requestRide: string;
      requesting: string;
      outcomePending: string;
      outcomeAccepted: string;
      viewMyTrips: string;
      continueWithVehicle: string;
      unavailableBanner: string;
      pointsUnavailableBanner: string;
      needsPrecisionTitle: string;
      cityLevel: string;
      stateLevel: string;
      neighborhoodLevel: string;
      postalCode: string;
      notFound: string;
      empty: string;
      originField: string;
      destinationField: string;
      continueWithoutCarpool: string;
      hostQuestion: string;
      yes: string;
      no: string;
      seatsLabel: string;
      hostHint: string;
      noFreeSeats: string;
    };
    buscar: {
      title: string;
      subtitle: string;
      originLabel: string;
      originPlaceholder: string;
      destinationLabel: string;
      destinationPlaceholder: string;
      dateTimeLabel: string;
      returnLabel: string;
      hostReturnLabel: string;
      requestedReturnLabel: string;
      seatsLabel: string;
      clearField: string;
      submit: string;
      searching: string;
      resultsTitle: string;
      searchSummaryTitle: string;
      requestedTimeLabel: string;
      noMatch: string;
      invalidInput: string;
      successTitle: string;
      successHint: string;
      newSearch: string;
      navFind: string;
      navMain: string;
      departureShort: string;
    };
    errors: {
      notAuthorized: string;
      notFound: string;
      invalidSeats: string;
      exceedsCapacity: string;
      disabledByPolicy: string;
      hostTripInactive: string;
      hostTripStarted: string;
      alreadyActive: string;
      alreadyDisabled: string;
      cannotReduce: string;
      noSeats: string;
      requestNotPending: string;
      requestExpired: string;
      notCompatible: string;
      unavailable: string;
      alreadyRequested: string;
      generic: string;
    };
    statuses: {
      PENDING: string;
      ACCEPTED: string;
      REJECTED: string;
      EXPIRED: string;
      CANCELLED: string;
      INVALIDATED: string;
    };
    reasons: {
      HOST_TRIP_CANCELLED: string;
      HOST_SCHEDULE_CHANGED: string;
      HOST_ROUTE_CHANGED: string;
      OFFER_DISABLED: string;
    };
    host: {
      sectionTitle: string;
      stateActive: string;
      stateDisabled: string;
      stateNone: string;
      seatsOffered: string;
      seatsAvailable: string;
      seatsInput: string;
      enable: string;
      update: string;
      disable: string;
      disableConfirm: string;
      participantsTitle: string;
      noParticipants: string;
      participantsUnavailable: string;
      requestsUnavailable: string;
      pendingTitle: string;
      noPending: string;
      requestedSeats: string;
      detourLine: string;
      pickupLabel: string;
      dropoffLabel: string;
      pickupAreaLabel: string;
      dropoffAreaLabel: string;
      approximateAreaHint: string;
      accept: string;
      reject: string;
      rejectConfirm: string;
      reasonPlaceholder: string;
      historyTitle: string;
      publishFailedNotice: string;
      actionErrorNotice: string;
      legacyNote: string;
      cannotOfferHint: string;
      maxSeatsHint: string;
    };
    rider: {
      myRequestsTitle: string;
      requestedFor: string;
      detourLine: string;
      cancel: string;
      cancelConfirm: string;
      viewTrip: string;
      actionErrorNotice: string;
    };
    policy: {
      title: string;
      description: string;
      currentVersion: string;
      noVersionYet: string;
      carpoolEnabled: string;
      carpoolFirstEnabled: string;
      hostOptInRequired: string;
      hostApprovalRequired: string;
      departureWindowMinutes: string;
      returnWindowMinutes: string;
      maxAdditionalDistanceKm: string;
      maxAdditionalTimeMinutes: string;
      maxCandidatesForPreciseRouting: string;
      requestExpiryMinutes: string;
      allowIntermediatePickup: string;
      allowIntermediateDropoff: string;
      minimumSeatAvailability: string;
      publish: string;
      publishing: string;
      published: string;
      invalidValues: string;
      notAuthorized: string;
      versionConflict: string;
      saveFailed: string;
      historyTitle: string;
      versionLabel: string;
      publishedAt: string;
      newVersionHint: string;
    };
  };
  /** Address autocomplete (Google Places) used by the trip and carpool address boxes. */
  placeAutocomplete: {
    available: string;
    availableOne: string;
    poweredBy: string;
    pointBadge: string;
    loading: string;
    listLabel: string;
  };
  /** Embedded route map card (Google Static Maps) shared by New Trip, Buscar Carona and the reservation detail. */
  routeMap: {
    title: string;
    loading: string;
    unavailable: string;
    estimated: string;
    approx: string;
    alt: string;
    origin: string;
    destination: string;
    dist: string;
    hm: string;
    m: string;
    h: string;
  };
  /** FleetMind v2.0, group B (Command Center, Veículos, Portaria, Relatórios, Usuários, Políticas). */
  ops: {
    cc: {
      title: string;
      subtitle: string;
      kpisLabel: string;
      kpiVehicles: string;
      kpiVehiclesBar: string;
      kpiPending: string;
      kpiActive: string;
      kpiConflicts: string;
      kpiTasks: string;
      kpiTasksMine: string;
      kpiCapped: string;
      kpiAttention: string;
    };
    gate: {
      title: string;
      subtitle: string;
      kpisLabel: string;
      kpiPickup: string;
      kpiInUse: string;
      kpiReturning: string;
      searchTitle: string;
      viewLabel: string;
      tabAll: string;
      tabPickup: string;
      tabReturn: string;
      noneInView: string;
      capNote: string;
      visualTitle: string;
      visualDescription: string;
      observedDamage: string;
      confirmVisual: string;
      waitingChecklist: string;
      recordMovement: string;
      checklistUnavailable: string;
      damagePhotoFailed: string;
      damagePhotoType: string;
      damagePhotoTooLarge: string;
      retryDamagePhoto: string;
      openEvidence: string;
    };
    fleet: {
      subtitle: string;
      kpisLabel: string;
      kpiTotal: string;
      kpiStatusBar: string;
      detailSubtitle: string;
    };
    reports: {
      title: string;
      subtitle: string;
      kpisLabel: string;
      kpiCompletedTrips: string;
      kpiAvgKm: string;
      kpiUnderused: string;
      kpiMaintenance: string;
      kpiCarpoolRate: string;
      noData: string;
      noCostData: string;
    };
    carpoolMgr: {
      subtitle: string;
    };
    users: {
      title: string;
      subtitle: string;
      summaryLabel: string;
      kpiTotal: string;
      kpiAuthorized: string;
      kpiNoLicense: string;
      kpiByRole: string;
    };
    settings: {
      title: string;
      subtitle: string;
      summaryLabel: string;
    };
  };
  navExtra: {
    maintenance: string;
    planning: string;
    workOrders: string;
    vehicleRecord: string;
    energy: string;
    drivers: string;
    incidents: string;
    gateExceptions: string;
    gateHistory: string;
    keyCustody: string;
    budgetApprovals: string;
    reservationApprovals: string;
    keyTracking: string;
    admin: string;
    myCarpools: string;
    carpoolManagement: string;
    skipToContent: string;
    openKeyCustody: string;
    openBudgetApprovals: string;
  };
  commandCenter: {
    title: string;
    subtitle: string;
    loading: string;
    loadError: string;
    loadErrorHint: string;
    retry: string;
    viewDetails: string;
    periodToday: string;
    period7d: string;
    period30d: string;
    periodMonth: string;
    periodAria: string;
    locationAria: string;
    allLocations: string;
    apply: string;
    degraded: string;
    kpisAria: string;
    vehiclesTotal: string;
    inOperation: string;
    available: string;
    inMaintenance: string;
    blocked: string;
    tripsPeriod: string;
    confirmed: string;
    completed: string;
    cancelled: string;
    byDeparture: string;
    ridesAccepted: string;
    sharedSeats: string;
    ridesNote: string;
    utilizationRate: string;
    utilizationHint: string;
    utilizationPending: string;
    occupancyRate: string;
    occupancyHint: string;
    occupancyPending: string;
    fleetLocation: string;
    mapUnavailable: string;
    mapNoSource: string;
    locationRegistered: string;
    locationsError: string;
    noLocationLabel: string;
    economyTitle: string;
    ecoCarpool: string;
    ecoBev: string;
    ecoElectric: string;
    ecoCo2: string;
    calcPending: string;
    fleetUtilization: string;
    utilizationCaption: string;
    seriesUnavailable: string;
    noDepartures: string;
    departuresCount: string;
    seatOccupancy: string;
    seatOccupancyEmpty: string;
    seatOccupancyCaption: string;
    tripsByUse: string;
    tripsByUseEmpty: string;
    vehiclesByCategory: string;
    noCategory: string;
    dataUnavailable: string;
    noVehicles: string;
    fleetStatus: string;
    noVehiclesFilter: string;
    upcomingMaintenance: string;
    noServiceByKm: string;
    reviewReached: string;
    untilReview: string;
    recentTrips: string;
    noTrips: string;
    driverFallback: string;
    tripFallback: string;
    vehicleFallback: string;
    destinationMissing: string;
    insightsCount: string;
    insightsUnconfirmed: string;
    noInsights: string;
    insightsCaption: string;
    insightBlockedTitle: string;
    insightBlockedText: string;
    insightTasksTitle: string;
    insightTasksText: string;
    insightLocationTitle: string;
    insightLocationText: string;
    insightMaintenanceTitle: string;
    insightMaintenanceText: string;
    alertsTitle: string;
    alertsUnavailable: string;
    noOpenTasks: string;
    quickActions: string;
    newReservation: string;
    findCarpool: string;
    manageVehicles: string;
    incidentsTasks: string;
    maintenance: string;
    reports: string;
    footnote: string;
    openControls: string;
    searchAria: string;
    searchPlaceholder: string;
    searchHeading: string;
    searchNoResults: string;
  };
  opsShell: {
    centralLink: string;
    success: string;
    unavailable: string;
    unavailableEnv: string;
    genericError: string;
    metricsAria: string;
    noRecords: string;
    vehicle: string;
    select: string;
    errors: {
      SELF_APPROVAL_DENIED: string;
      SUPERIOR_APPROVAL_REQUIRED: string;
      APPROVER_NOT_AUTHORIZED: string;
      BUDGET_APPROVAL_PENDING: string;
      MANAGEMENT_SCOPE_DENIED: string;
      NOT_AUTHORIZED: string;
      NOT_FOUND: string;
      INVALID_INPUT: string;
      INVALID_STATE_TRANSITION: string;
      CONCURRENT_UPDATE: string;
      IDEMPOTENCY_CONFLICT: string;
      MAINTENANCE_CONFLICT: string;
      RESERVATION_CONFLICT: string;
      POWERTRAIN_MISMATCH: string;
      APPROVED_BUDGET_EXCEEDED: string;
      RESERVATION_EXPIRED: string;
      DAMAGE_RELEASE_INDEPENDENT_ACTOR_REQUIRED: string;
      DEPARTURE_BLOCKED: string;
      CHECKLIST_REQUIRED: string;
      OUTSIDE_RESERVATION_WINDOW: string;
      OUTSIDE_MAINTENANCE_WINDOW: string;
      LEGACY_ARRIVAL_REASON_REQUIRED: string;
      VEHICLE_NOT_READY: string;
      IMMUTABLE_VIN: string;
      GATE_SELF_RELEASE_NOT_AUTHORIZED: string;
      INDEPENDENT_ACTOR_REQUIRED: string;
      PHYSICAL_DEPARTURE_ALREADY_RECORDED: string;
      EXCEPTION_NOT_REQUIRED: string;
      VEHICLE_ON_TRIP: string;
      KEYS_OUTSTANDING: string;
    };
  };
  rpcErrors: {
    cancelBlockedOperationStarted: string;
    photoIntegrityMismatch: string;
    photoHashMismatch: string;
  };
  maintenance: {
    titleOverviewManager: string;
    titleOverview: string;
    titlePlanning: string;
    titleOrders: string;
    titleVehicle: string;
    subtitle: string;
    mOperational: string;
    mInMaintenance: string;
    mScheduled: string;
    mInProgress: string;
    mEffectiveCost: string;
    mEffectiveCostDetail: string;
    tabsAria: string;
    tabOverview: string;
    tabPlanning: string;
    tabOrders: string;
    tabRecord: string;
    identityPanel: string;
    vehicleLabel: string;
    consult: string;
    fleetUnavailable: string;
    noVehicles: string;
    vinLine: string;
    notInformed: string;
    vehicleDocs: string;
    equipmentLink: string;
    exportCsv: string;
    odometer: string;
    nextServiceKm: string;
    nextServiceDate: string;
    costsPanel: string;
    historyUnavailable: string;
    voidNote: string;
    conditionPanel: string;
    state: string;
    currentLocation: string;
    serviceByTime: string;
    serviceByKm: string;
    serviceNote: string;
    techPanel: string;
    vinField: string;
    save: string;
    ordersPanel: string;
    newOrderLink: string;
    orderServicesCosts: string;
    newOrderPanel: string;
    maintKind: string;
    kindPreventive: string;
    kindCorrective: string;
    kindInspection: string;
    descDiagnosis: string;
    supplierShop: string;
    initialQuote: string;
    createOrder: string;
    summaryPanel: string;
    osShort: string;
    supplier: string;
    createdAt: string;
    scheduledStart: string;
    scheduledEnd: string;
    openRecord: string;
    historyPanel: string;
    versionNote: string;
    completedOn: string;
    calendarPanel: string;
    upcomingConflicts: string;
    fleetAndOrders: string;
    firstOrderNote: string;
    operationVehicles: string;
    alertsPanel: string;
    activeBlock: string;
    inProgressNote: string;
    noBlocks: string;
    costsSidePanel: string;
    costsUnavailable: string;
    ordersByStatus: string;
    dataUnavailable: string;
    plannedReviews: string;
    dateKm: string;
    noReviews: string;
    searchOrder: string;
    status: string;
    all: string;
    filter: string;
    ordersUnavailable: string;
    colOrder: string;
    colVehicle: string;
    colKindDesc: string;
    colSchedule: string;
    colStatus: string;
    colGwmCost: string;
    colDetails: string;
    open: string;
    costExecuted: string;
    costWarranty: string;
    costEffective: string;
    orderDocs: string;
    approvalHistory: string;
    approvalsUnavailable: string;
    noApprovals: string;
    policyRevision: string;
    superiorAuthorized: string;
    managerApprover: string;
    stagesAria: string;
    quote: string;
    approved: string;
    effectiveGwm: string;
    linesUnavailable: string;
    noLines: string;
    colItem: string;
    colType: string;
    colQty: string;
    colUnit: string;
    colTotal: string;
    colCoverage: string;
    colCorrection: string;
    stageActual: string;
    stagePlanned: string;
    voidedReason: string;
    catParts: string;
    catLabor: string;
    catService: string;
    catOther: string;
    covVoided: string;
    covWarranty: string;
    covGwm: string;
    voidEntry: string;
    justification: string;
    voidWithRecord: string;
    addItem: string;
    description: string;
    nature: string;
    category: string;
    quantity: string;
    unitPrice: string;
    warrantyCheck: string;
    registerItem: string;
    reviewBudget: string;
    newValue: string;
    revisionReason: string;
    revisionNote: string;
    registerRevision: string;
    budgetPending: string;
    approveRevisedNote: string;
    approveRevised: string;
    reschedule: string;
    scheduleMaint: string;
    startBrasilia: string;
    endBrasilia: string;
    validateSchedule: string;
    actCancel: string;
    actStart: string;
    actComplete: string;
    actApprove: string;
    actSend: string;
    actPartial: string;
    windowNote: string;
    colState: string;
    colLocation: string;
    colOdometer: string;
    colNextReview: string;
    colRecord: string;
    consultArrow: string;
    reviewsReached: string;
    reviewTag: string;
    dueLine: string;
    noneDue: string;
    planningUnavailable: string;
    noWindows: string;
    brasiliaSuffix: string;
    toRange: string;
    planningNote: string;
    orderStates: {
      draft: string;
      budgeted: string;
      approved: string;
      scheduled: string;
      in_progress: string;
      partial: string;
      completed: string;
      cancelled: string;
    };
    adj: {
      aria: string;
      heading: string;
      note: string;
      unavailable: string;
      none: string;
      pending: string;
      approved: string;
      rejected: string;
      decision: string;
      decisionReason: string;
      approve: string;
      reject: string;
      propose: string;
      delta: string;
      reason: string;
      submit: string;
    };
  };
  /** Audit-log action codes -> plain-language labels (/admin, /admin/audit). Unknown codes use `fallback`. */
  auditActions: {
    labels: Record<string, string>;
    fallback: string;
  };
};
