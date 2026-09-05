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
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["user_role"] | null
          after: Json | null
          before: Json | null
          correlation_id: string
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          organization_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          after?: Json | null
          before?: Json | null
          correlation_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          organization_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["user_role"] | null
          after?: Json | null
          before?: Json | null
          correlation_id?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_photos: {
        Row: {
          angle: Database["public"]["Enums"]["photo_angle"]
          created_at: string
          id: string
          inspection_id: string
          organization_id: string
          storage_path: string
        }
        Insert: {
          angle: Database["public"]["Enums"]["photo_angle"]
          created_at?: string
          id?: string
          inspection_id: string
          organization_id: string
          storage_path: string
        }
        Update: {
          angle?: Database["public"]["Enums"]["photo_angle"]
          created_at?: string
          id?: string
          inspection_id?: string
          organization_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_photos_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_photos_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          battery_level_percent: number | null
          created_at: string
          damage_notes: string | null
          fuel_level_percent: number | null
          has_new_damage: boolean
          id: string
          is_dirty_exterior: boolean
          is_dirty_interior: boolean
          missing_safety_equipment: string[]
          odometer_km: number
          organization_id: string
          performed_by: string
          performed_by_role: Database["public"]["Enums"]["inspection_role"]
          reservation_id: string
          type: Database["public"]["Enums"]["inspection_type"]
          vehicle_id: string
        }
        Insert: {
          battery_level_percent?: number | null
          created_at?: string
          damage_notes?: string | null
          fuel_level_percent?: number | null
          has_new_damage?: boolean
          id?: string
          is_dirty_exterior?: boolean
          is_dirty_interior?: boolean
          missing_safety_equipment?: string[]
          odometer_km: number
          organization_id: string
          performed_by: string
          performed_by_role: Database["public"]["Enums"]["inspection_role"]
          reservation_id: string
          type: Database["public"]["Enums"]["inspection_type"]
          vehicle_id: string
        }
        Update: {
          battery_level_percent?: number | null
          created_at?: string
          damage_notes?: string | null
          fuel_level_percent?: number | null
          has_new_damage?: boolean
          id?: string
          is_dirty_exterior?: boolean
          is_dirty_interior?: boolean
          missing_safety_equipment?: string[]
          odometer_km?: number
          organization_id?: string
          performed_by?: string
          performed_by_role?: Database["public"]["Enums"]["inspection_role"]
          reservation_id?: string
          type?: Database["public"]["Enums"]["inspection_type"]
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          organization_id: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          organization_id: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          organization_id?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          booking_mode: Database["public"]["Enums"]["booking_mode"]
          carpool_departure_tolerance_minutes: number
          carpool_return_tolerance_minutes: number
          early_pickup_grace_minutes: number
          maintenance_due_soon_days: number
          min_charge_hours_bev: number
          min_cleaning_hours: number
          min_refuel_hours_ice_or_phev: number
          organization_id: string
          range_safety_buffer_percent: number
          traffic_restriction_enabled: boolean
        }
        Insert: {
          booking_mode?: Database["public"]["Enums"]["booking_mode"]
          carpool_departure_tolerance_minutes?: number
          carpool_return_tolerance_minutes?: number
          early_pickup_grace_minutes?: number
          maintenance_due_soon_days?: number
          min_charge_hours_bev?: number
          min_cleaning_hours?: number
          min_refuel_hours_ice_or_phev?: number
          organization_id: string
          range_safety_buffer_percent?: number
          traffic_restriction_enabled?: boolean
        }
        Update: {
          booking_mode?: Database["public"]["Enums"]["booking_mode"]
          carpool_departure_tolerance_minutes?: number
          carpool_return_tolerance_minutes?: number
          early_pickup_grace_minutes?: number
          maintenance_due_soon_days?: number
          min_charge_hours_bev?: number
          min_cleaning_hours?: number
          min_refuel_hours_ice_or_phev?: number
          organization_id?: string
          range_safety_buffer_percent?: number
          traffic_restriction_enabled?: boolean
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
          driver_authorized: boolean
          drivers_license_category: string | null
          drivers_license_expiration: string | null
          drivers_license_number: string | null
          full_name: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          created_at?: string
          driver_authorized?: boolean
          drivers_license_category?: string | null
          drivers_license_expiration?: string | null
          drivers_license_number?: string | null
          full_name: string
          id: string
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          created_at?: string
          driver_authorized?: boolean
          drivers_license_category?: string | null
          drivers_license_expiration?: string | null
          drivers_license_number?: string | null
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
      reservation_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          message_type: Database["public"]["Enums"]["message_type"]
          organization_id: string
          reservation_id: string
          sender_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          message_type?: Database["public"]["Enums"]["message_type"]
          organization_id: string
          reservation_id: string
          sender_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          message_type?: Database["public"]["Enums"]["message_type"]
          organization_id?: string
          reservation_id?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reservation_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_messages_reservation_id_fkey"
            columns: ["reservation_id"]
            isOneToOne: false
            referencedRelation: "reservations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservation_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reservations: {
        Row: {
          active_status: boolean | null
          approved_at: string | null
          approved_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          end_at: string
          id: string
          impacted_at: string | null
          impacted_reason: string | null
          organization_id: string
          start_at: string
          status: Database["public"]["Enums"]["reservation_status"]
          trip_request_id: string
          vehicle_id: string
        }
        Insert: {
          active_status?: boolean | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          end_at: string
          id?: string
          impacted_at?: string | null
          impacted_reason?: string | null
          organization_id: string
          start_at: string
          status?: Database["public"]["Enums"]["reservation_status"]
          trip_request_id: string
          vehicle_id: string
        }
        Update: {
          active_status?: boolean | null
          approved_at?: string | null
          approved_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          end_at?: string
          id?: string
          impacted_at?: string | null
          impacted_reason?: string | null
          organization_id?: string
          start_at?: string
          status?: Database["public"]["Enums"]["reservation_status"]
          trip_request_id?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reservations_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reservations_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
      trip_participants: {
        Row: {
          id: string
          joined_at: string
          organization_id: string
          passenger_count: number
          passenger_id: string
          status: string
          trip_request_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          organization_id: string
          passenger_count?: number
          passenger_id: string
          status?: string
          trip_request_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          organization_id?: string
          passenger_count?: number
          passenger_id?: string
          status?: string
          trip_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_participants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_participants_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_participants_trip_request_id_fkey"
            columns: ["trip_request_id"]
            isOneToOne: false
            referencedRelation: "trip_requests"
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
      workflow_tasks: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          resolved_at: string | null
          source_inspection_id: string | null
          status: Database["public"]["Enums"]["workflow_task_status"]
          type: Database["public"]["Enums"]["workflow_task_type"]
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          resolved_at?: string | null
          source_inspection_id?: string | null
          status?: Database["public"]["Enums"]["workflow_task_status"]
          type: Database["public"]["Enums"]["workflow_task_type"]
          vehicle_id: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          resolved_at?: string | null
          source_inspection_id?: string | null
          status?: Database["public"]["Enums"]["workflow_task_status"]
          type?: Database["public"]["Enums"]["workflow_task_type"]
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_tasks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_tasks_source_inspection_id_fkey"
            columns: ["source_inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_tasks_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      approve_reservation: {
        Args: { p_reservation_id: string }
        Returns: undefined
      }
      auto_reassign_reservation_vehicle: {
        Args: {
          p_new_vehicle_id: string
          p_organization_id: string
          p_reservation_id: string
        }
        Returns: undefined
      }
      block_vehicle: {
        Args: { p_reason: string; p_vehicle_id: string }
        Returns: undefined
      }
      cancel_reservation: {
        Args: { p_reason?: string; p_reservation_id: string }
        Returns: undefined
      }
      cancel_workflow_task: { Args: { p_task_id: string }; Returns: undefined }
      complete_workflow_task: {
        Args: { p_task_id: string }
        Returns: undefined
      }
      create_carpool_participation: {
        Args: {
          p_departure_at: string
          p_destination: string
          p_distance_km: number
          p_existing_trip_request_id: string
          p_expected_return_at: string
          p_justification: string
          p_origin: string
          p_passenger_count: number
          p_requires_cargo: boolean
        }
        Returns: string
      }
      create_vehicle_reservation: {
        Args: {
          p_departure_at: string
          p_destination: string
          p_distance_km: number
          p_expected_return_at: string
          p_justification: string
          p_origin: string
          p_passenger_count: number
          p_requires_cargo: boolean
          p_vehicle_id: string
        }
        Returns: string
      }
      current_organization_id: { Args: never; Returns: string }
      lock_and_require_multiple_administrators: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      log_audit_event: {
        Args: {
          p_action: string
          p_actor_id: string
          p_after?: Json
          p_before?: Json
          p_entity_id: string
          p_entity_type: string
          p_organization_id: string
        }
        Returns: undefined
      }
      post_reservation_message: {
        Args: {
          p_body: string
          p_message_type: Database["public"]["Enums"]["message_type"]
          p_new_expected_return_at?: string
          p_reservation_id: string
        }
        Returns: Json
      }
      record_pickup: {
        Args: {
          p_battery_level_percent: number
          p_damage_notes: string
          p_fuel_level_percent: number
          p_has_damage: boolean
          p_is_dirty_exterior: boolean
          p_is_dirty_interior: boolean
          p_missing_safety_equipment: string[]
          p_odometer_km: number
          p_reservation_id: string
          p_role: Database["public"]["Enums"]["inspection_role"]
        }
        Returns: string
      }
      record_return: {
        Args: {
          p_battery_level_percent: number
          p_current_location_id?: string
          p_damage_notes: string
          p_fuel_level_percent: number
          p_has_new_damage: boolean
          p_is_dirty_exterior: boolean
          p_is_dirty_interior: boolean
          p_missing_safety_equipment: string[]
          p_odometer_km: number
          p_reservation_id: string
          p_role: Database["public"]["Enums"]["inspection_role"]
          p_vehicle_event: string
          p_workflow_tasks: Database["public"]["Enums"]["workflow_task_type"][]
        }
        Returns: string
      }
      respond_to_carpool_request: {
        Args: { p_accept: boolean; p_participant_id: string }
        Returns: undefined
      }
      swap_reservation_vehicle: {
        Args: { p_new_vehicle_id: string; p_reservation_id: string }
        Returns: undefined
      }
      transfer_reservation: {
        Args: { p_new_requester_id: string; p_reservation_id: string }
        Returns: undefined
      }
      unblock_vehicle: { Args: { p_vehicle_id: string }; Returns: undefined }
      update_member_role: {
        Args: {
          p_new_role: Database["public"]["Enums"]["user_role"]
          p_organization_id: string
          p_user_id: string
        }
        Returns: undefined
      }
    }
    Enums: {
      booking_mode: "ai_recommended" | "user_choice" | "hybrid"
      energy_type: "ICE" | "PHEV" | "BEV"
      inspection_role: "traveler" | "security"
      inspection_type: "pickup" | "return"
      message_type:
        | "text"
        | "delay"
        | "vehicle_issue"
        | "return_time_change"
        | "vehicle_not_found"
        | "system_alert"
      photo_angle:
        | "front"
        | "back"
        | "left_side"
        | "right_side"
        | "wheels"
        | "interior"
        | "damage"
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
      workflow_task_status: "open" | "in_progress" | "done" | "cancelled"
      workflow_task_type:
        | "repair"
        | "safety"
        | "preventive_maintenance"
        | "cleaning"
        | "fuel"
        | "charging"
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
      booking_mode: ["ai_recommended", "user_choice", "hybrid"],
      energy_type: ["ICE", "PHEV", "BEV"],
      inspection_role: ["traveler", "security"],
      inspection_type: ["pickup", "return"],
      message_type: [
        "text",
        "delay",
        "vehicle_issue",
        "return_time_change",
        "vehicle_not_found",
        "system_alert",
      ],
      photo_angle: [
        "front",
        "back",
        "left_side",
        "right_side",
        "wheels",
        "interior",
        "damage",
      ],
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
      workflow_task_status: ["open", "in_progress", "done", "cancelled"],
      workflow_task_type: [
        "repair",
        "safety",
        "preventive_maintenance",
        "cleaning",
        "fuel",
        "charging",
      ],
    },
  },
} as const

