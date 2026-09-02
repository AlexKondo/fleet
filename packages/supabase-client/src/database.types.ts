export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      organization_settings: {
        Row: {
          min_charge_hours_bev: number
          min_cleaning_hours: number
          min_refuel_hours_ice_or_phev: number
          organization_id: string
          range_safety_buffer_percent: number
        }
        Insert: {
          min_charge_hours_bev?: number
          min_cleaning_hours?: number
          min_refuel_hours_ice_or_phev?: number
          organization_id: string
          range_safety_buffer_percent?: number
        }
        Update: {
          min_charge_hours_bev?: number
          min_cleaning_hours?: number
          min_refuel_hours_ice_or_phev?: number
          organization_id?: string
          range_safety_buffer_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          active_status: boolean | null
          created_at: string
          end_at: string
          id: string
          organization_id: string
          start_at: string
          status: Database["public"]["Enums"]["reservation_status"]
          trip_request_id: string
          vehicle_id: string
        }
        Insert: {
          active_status?: boolean | null
          created_at?: string
          end_at: string
          id?: string
          organization_id: string
          start_at: string
          status?: Database["public"]["Enums"]["reservation_status"]
          trip_request_id: string
          vehicle_id: string
        }
        Update: {
          active_status?: boolean | null
          created_at?: string
          end_at?: string
          id?: string
          organization_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          trip_request_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_trip_request_id_fkey"
            columns: ["trip_request_id"]
            isOneToOne: false
            referencedRelation: "trip_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_requests: {
        Row: {
          created_at: string
          departure_at: string
          destination: string
          distance_km: number
          expected_return_at: string
          id: string
          justification: string
          organization_id: string
          origin: string
          passenger_count: number
          requester_id: string
          requires_cargo: boolean
        }
        Insert: {
          created_at?: string
          departure_at: string
          destination: string
          distance_km: number
          expected_return_at: string
          id?: string
          justification: string
          organization_id: string
          origin: string
          passenger_count: number
          requester_id: string
          requires_cargo?: boolean
        }
        Update: {
          created_at?: string
          departure_at?: string
          destination?: string
          distance_km?: number
          expected_return_at?: string
          id?: string
          justification?: string
          organization_id?: string
          origin?: string
          passenger_count?: number
          requester_id?: string
          requires_cargo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "trip_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_categories: {
        Row: {
          id: string
          name: string
          organization_id: string
          passenger_capacity: number
          supports_cargo: boolean
        }
        Insert: {
          id?: string
          name: string
          organization_id: string
          passenger_capacity: number
          supports_cargo?: boolean
        }
        Update: {
          id?: string
          name?: string
          organization_id?: string
          passenger_capacity?: number
          supports_cargo?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_locations: {
        Row: {
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          battery_level_percent: number | null
          category_id: string
          created_at: string
          current_location_id: string | null
          documentation_valid: boolean
          energy_type: Database["public"]["Enums"]["energy_type"]
          estimated_range_km: number
          fuel_level_percent: number | null
          has_blocking_damage: boolean
          home_location_id: string | null
          id: string
          is_clean_exterior: boolean
          is_clean_interior: boolean
          missing_safety_equipment: string[]
          next_service_odometer_km: number | null
          odometer_km: number
          organization_id: string
          plate: string
          status: Database["public"]["Enums"]["vehicle_status"]
          updated_at: string
        }
        Insert: {
          battery_level_percent?: number | null
          category_id: string
          created_at?: string
          current_location_id?: string | null
          documentation_valid?: boolean
          energy_type: Database["public"]["Enums"]["energy_type"]
          estimated_range_km?: number
          fuel_level_percent?: number | null
          has_blocking_damage?: boolean
          home_location_id?: string | null
          id?: string
          is_clean_exterior?: boolean
          is_clean_interior?: boolean
          missing_safety_equipment?: string[]
          next_service_odometer_km?: number | null
          odometer_km?: number
          organization_id: string
          plate: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
        }
        Update: {
          battery_level_percent?: number | null
          category_id?: string
          created_at?: string
          current_location_id?: string | null
          documentation_valid?: boolean
          energy_type?: Database["public"]["Enums"]["energy_type"]
          estimated_range_km?: number
          fuel_level_percent?: number | null
          has_blocking_damage?: boolean
          home_location_id?: string | null
          id?: string
          is_clean_exterior?: boolean
          is_clean_interior?: boolean
          missing_safety_equipment?: string[]
          next_service_odometer_km?: number | null
          odometer_km?: number
          organization_id?: string
          plate?: string
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "vehicle_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_current_location_id_fkey"
            columns: ["current_location_id"]
            isOneToOne: false
            referencedRelation: "vehicle_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_home_location_id_fkey"
            columns: ["home_location_id"]
            isOneToOne: false
            referencedRelation: "vehicle_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_organization_id: { Args: never; Returns: string }
    }
    Enums: {
      energy_type: "ICE" | "PHEV" | "BEV"
      reservation_status:
        | "pending_approval"
        | "confirmed"
        | "cancelled"
        | "completed"
      user_role:
        | "employee"
        | "fleet_manager"
        | "security"
        | "maintenance_operator"
        | "administrator"
      vehicle_status:
        | "available"
        | "reserved"
        | "awaiting_pickup"
        | "in_use"
        | "returning"
        | "inspection"
        | "charging"
        | "cleaning"
        | "maintenance"
        | "blocked"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      energy_type: ["ICE", "PHEV", "BEV"],
      reservation_status: [
        "pending_approval",
        "confirmed",
        "cancelled",
        "completed",
      ],
      user_role: [
        "employee",
        "fleet_manager",
        "security",
        "maintenance_operator",
        "administrator",
      ],
      vehicle_status: [
        "available",
        "reserved",
        "awaiting_pickup",
        "in_use",
        "returning",
        "inspection",
        "charging",
        "cleaning",
        "maintenance",
        "blocked",
      ],
    },
  },
} as const

