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
          observation_kind: string
          actor_role_at_recording: Database["public"]["Enums"]["user_role"] | null
          recorded_location_id: string | null
          battery_level_percent: number | null
          created_at: string
          damage_notes: string | null
          fuel_level_percent: number | null
          has_new_damage: boolean
          id: string
          is_dirty_exterior: boolean | null
          is_dirty_interior: boolean | null
          missing_safety_equipment: string[] | null
          odometer_km: number | null
          organization_id: string
          performed_by: string
          performed_by_role: Database["public"]["Enums"]["inspection_role"]
          reservation_id: string
          type: Database["public"]["Enums"]["inspection_type"]
          vehicle_id: string
        }
        Insert: {
          observation_kind?: string
          actor_role_at_recording?: Database["public"]["Enums"]["user_role"] | null
          recorded_location_id?: string | null
          battery_level_percent?: number | null
          created_at?: string
          damage_notes?: string | null
          fuel_level_percent?: number | null
          has_new_damage?: boolean
          id?: string
          is_dirty_exterior?: boolean | null
          is_dirty_interior?: boolean | null
          missing_safety_equipment?: string[] | null
          odometer_km: number | null
          organization_id: string
          performed_by: string
          performed_by_role: Database["public"]["Enums"]["inspection_role"]
          reservation_id: string
          type: Database["public"]["Enums"]["inspection_type"]
          vehicle_id: string
        }
        Update: {
          observation_kind?: string
          actor_role_at_recording?: Database["public"]["Enums"]["user_role"] | null
          recorded_location_id?: string | null
          battery_level_percent?: number | null
          created_at?: string
          damage_notes?: string | null
          fuel_level_percent?: number | null
          has_new_damage?: boolean
          id?: string
          is_dirty_exterior?: boolean | null
          is_dirty_interior?: boolean | null
          missing_safety_equipment?: string[] | null
          odometer_km?: number | null
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
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          intent: string | null
          role: string
          slots: Json | null
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          intent?: string | null
          role: string
          slots?: Json | null
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          intent?: string | null
          role?: string
          slots?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          organization_id: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          organization_id: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
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
          auto_release_enabled: boolean
          booking_mode: Database["public"]["Enums"]["booking_mode"]
          carpool_departure_tolerance_minutes: number
          carpool_return_tolerance_minutes: number
          early_pickup_grace_minutes: number
          maintenance_due_soon_km: number
          min_charge_hours_bev: number
          min_cleaning_hours: number
          min_refuel_hours_ice_or_phev: number
          organization_id: string
          range_safety_buffer_percent: number
          traffic_restriction_enabled: boolean
        }
        Insert: {
          auto_release_enabled?: boolean
          booking_mode?: Database["public"]["Enums"]["booking_mode"]
          carpool_departure_tolerance_minutes?: number
          carpool_return_tolerance_minutes?: number
          early_pickup_grace_minutes?: number
          maintenance_due_soon_km?: number
          min_charge_hours_bev?: number
          min_cleaning_hours?: number
          min_refuel_hours_ice_or_phev?: number
          organization_id: string
          range_safety_buffer_percent?: number
          traffic_restriction_enabled?: boolean
        }
        Update: {
          auto_release_enabled?: boolean
          booking_mode?: Database["public"]["Enums"]["booking_mode"]
          carpool_departure_tolerance_minutes?: number
          carpool_return_tolerance_minutes?: number
          early_pickup_grace_minutes?: number
          maintenance_due_soon_km?: number
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
          avatar_url: string | null
          created_at: string
          driver_authorized: boolean
          drivers_license_category: string | null
          drivers_license_expiration: string | null
          drivers_license_expiration_source: string | null
          drivers_license_number: string | null
          full_name: string
          gantt_zoom_preference: string
          id: string
          license_reminder_1mo_sent_at: string | null
          license_reminder_3mo_sent_at: string | null
          license_reminder_6mo_sent_at: string | null
          organization_id: string
          role: Database["public"]["Enums"]["user_role"]
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          driver_authorized?: boolean
          drivers_license_category?: string | null
          drivers_license_expiration?: string | null
          drivers_license_expiration_source?: string | null
          drivers_license_number?: string | null
          full_name: string
          gantt_zoom_preference?: string
          id: string
          license_reminder_1mo_sent_at?: string | null
          license_reminder_3mo_sent_at?: string | null
          license_reminder_6mo_sent_at?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["user_role"]
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          driver_authorized?: boolean
          drivers_license_category?: string | null
          drivers_license_expiration?: string | null
          drivers_license_expiration_source?: string | null
          drivers_license_number?: string | null
          full_name?: string
          gantt_zoom_preference?: string
          id?: string
          license_reminder_1mo_sent_at?: string | null
          license_reminder_3mo_sent_at?: string | null
          license_reminder_6mo_sent_at?: string | null
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
      route_map_user_usage: {
        Row: {
          day: string
          updated_at: string
          user_id: string
          views: number
        }
        Insert: {
          day: string
          updated_at?: string
          user_id: string
          views?: number
        }
        Update: {
          day?: string
          updated_at?: string
          user_id?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "route_map_user_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_daily_geo_usage: {
        Row: {
          calls: number
          day: string
          kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calls?: number
          day: string
          kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calls?: number
          day?: string
          kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_daily_geo_usage_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_equipment_items: {
        Row: {
          enabled: boolean
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          enabled?: boolean
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          enabled?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_equipment_items_organization_id_fkey"
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
      carpool_search_log: {
        Row: {
          compatible_count: number
          created_at: string
          id: string
          latency_ms: number
          offers_evaluated: number
          organization_id: string
          outcome: string
          precise_route_calls: number
          prefilter_candidates: number
          source: string
          user_id: string | null
        }
        Insert: {
          compatible_count?: number
          created_at?: string
          id?: string
          latency_ms?: number
          offers_evaluated?: number
          organization_id: string
          outcome: string
          precise_route_calls?: number
          prefilter_candidates?: number
          source: string
          user_id?: string | null
        }
        Update: {
          compatible_count?: number
          created_at?: string
          id?: string
          latency_ms?: number
          offers_evaluated?: number
          organization_id?: string
          outcome?: string
          precise_route_calls?: number
          prefilter_candidates?: number
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carpool_search_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carpool_search_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      carpool_events: {
        Row: {
          actor_id: string | null
          carpool_offer_id: string | null
          carpool_ride_request_id: string | null
          created_at: string
          event_type: string
          id: string
          organization_id: string
          payload: Json
          trip_request_id: string | null
        }
        Insert: {
          actor_id?: string | null
          carpool_offer_id?: string | null
          carpool_ride_request_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          organization_id: string
          payload?: Json
          trip_request_id?: string | null
        }
        Update: {
          actor_id?: string | null
          carpool_offer_id?: string | null
          carpool_ride_request_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          organization_id?: string
          payload?: Json
          trip_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carpool_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carpool_events_carpool_offer_id_fkey"
            columns: ["carpool_offer_id"]
            isOneToOne: false
            referencedRelation: "carpool_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carpool_events_carpool_ride_request_id_fkey"
            columns: ["carpool_ride_request_id"]
            isOneToOne: false
            referencedRelation: "carpool_ride_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carpool_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carpool_events_trip_request_id_fkey"
            columns: ["trip_request_id"]
            isOneToOne: false
            referencedRelation: "trip_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      carpool_offers: {
        Row: {
          created_at: string
          host_id: string
          id: string
          organization_id: string
          policy_version: number
          seats_available: number
          seats_offered: number
          status: string
          trip_request_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          host_id: string
          id?: string
          organization_id: string
          policy_version: number
          seats_available: number
          seats_offered: number
          status?: string
          trip_request_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          host_id?: string
          id?: string
          organization_id?: string
          policy_version?: number
          seats_available?: number
          seats_offered?: number
          status?: string
          trip_request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carpool_offers_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carpool_offers_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carpool_offers_trip_request_id_fkey"
            columns: ["trip_request_id"]
            isOneToOne: false
            referencedRelation: "trip_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      carpool_policy_settings: {
        Row: {
          allow_intermediate_dropoff: boolean
          allow_intermediate_pickup: boolean
          carpool_enabled: boolean
          carpool_first_enabled: boolean
          created_at: string
          departure_window_minutes: number
          host_approval_required: boolean
          host_opt_in_required: boolean
          id: string
          max_additional_distance_km: number
          max_additional_time_minutes: number
          max_candidates_for_precise_routing: number
          minimum_seat_availability: number
          organization_id: string
          policy_version: number
          request_expiry_minutes: number
          return_window_minutes: number
        }
        Insert: {
          allow_intermediate_dropoff?: boolean
          allow_intermediate_pickup?: boolean
          carpool_enabled?: boolean
          carpool_first_enabled?: boolean
          created_at?: string
          departure_window_minutes: number
          host_approval_required?: boolean
          host_opt_in_required?: boolean
          id?: string
          max_additional_distance_km: number
          max_additional_time_minutes: number
          max_candidates_for_precise_routing?: number
          minimum_seat_availability?: number
          organization_id: string
          policy_version: number
          request_expiry_minutes?: number
          return_window_minutes: number
        }
        Update: {
          allow_intermediate_dropoff?: boolean
          allow_intermediate_pickup?: boolean
          carpool_enabled?: boolean
          carpool_first_enabled?: boolean
          created_at?: string
          departure_window_minutes?: number
          host_approval_required?: boolean
          host_opt_in_required?: boolean
          id?: string
          max_additional_distance_km?: number
          max_additional_time_minutes?: number
          max_candidates_for_precise_routing?: number
          minimum_seat_availability?: number
          organization_id?: string
          policy_version?: number
          request_expiry_minutes?: number
          return_window_minutes?: number
        }
        Relationships: [
          {
            foreignKeyName: "carpool_policy_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      carpool_ride_requests: {
        Row: {
          carpool_offer_id: string
          client_request_id: string | null
          created_at: string
          dropoff_location: Json | null
          host_destination_snapshot: string | null
          host_origin_snapshot: string | null
          id: string
          match_additional_distance_km: number | null
          match_additional_time_min: number | null
          organization_id: string
          pickup_location: Json | null
          policy_version: number
          requested_departure_at: string
          requested_seats: number
          responded_at: string | null
          responded_by: string | null
          rider_id: string
          status: string
          status_reason: string | null
          updated_at: string
        }
        Insert: {
          carpool_offer_id: string
          client_request_id?: string | null
          created_at?: string
          dropoff_location?: Json | null
          host_destination_snapshot?: string | null
          host_origin_snapshot?: string | null
          id?: string
          match_additional_distance_km?: number | null
          match_additional_time_min?: number | null
          organization_id: string
          pickup_location?: Json | null
          policy_version: number
          requested_departure_at: string
          requested_seats: number
          responded_at?: string | null
          responded_by?: string | null
          rider_id: string
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Update: {
          carpool_offer_id?: string
          client_request_id?: string | null
          created_at?: string
          dropoff_location?: Json | null
          host_destination_snapshot?: string | null
          host_origin_snapshot?: string | null
          id?: string
          match_additional_distance_km?: number | null
          match_additional_time_min?: number | null
          organization_id?: string
          pickup_location?: Json | null
          policy_version?: number
          requested_departure_at?: string
          requested_seats?: number
          responded_at?: string | null
          responded_by?: string | null
          rider_id?: string
          status?: string
          status_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carpool_ride_requests_carpool_offer_id_fkey"
            columns: ["carpool_offer_id"]
            isOneToOne: false
            referencedRelation: "carpool_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carpool_ride_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carpool_ride_requests_responded_by_fkey"
            columns: ["responded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "carpool_ride_requests_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      corporate_mobility_points: {
        Row: {
          address_label: string
          aliases: string[]
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          latitude: number
          longitude: number
          name: string
          organization_id: string
          provider_place_ref: string | null
          updated_at: string
        }
        Insert: {
          address_label: string
          aliases?: string[]
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          latitude: number
          longitude: number
          name: string
          organization_id: string
          provider_place_ref?: string | null
          updated_at?: string
        }
        Update: {
          address_label?: string
          aliases?: string[]
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          latitude?: number
          longitude?: number
          name?: string
          organization_id?: string
          provider_place_ref?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "corporate_mobility_points_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      geo_provider_quota_counters: {
        Row: {
          call_count: number
          circuit_opened_at: string | null
          circuit_state: string
          consecutive_failure_count: number
          day: string
          error_count: number
          id: string
          organization_id: string
          provider_call_kind: string
          total_latency_ms: number
          updated_at: string
        }
        Insert: {
          call_count?: number
          circuit_opened_at?: string | null
          circuit_state?: string
          consecutive_failure_count?: number
          day: string
          error_count?: number
          id?: string
          organization_id: string
          provider_call_kind: string
          total_latency_ms?: number
          updated_at?: string
        }
        Update: {
          call_count?: number
          circuit_opened_at?: string | null
          circuit_state?: string
          consecutive_failure_count?: number
          day?: string
          error_count?: number
          id?: string
          organization_id?: string
          provider_call_kind?: string
          total_latency_ms?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "geo_provider_quota_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_participants: {
        Row: {
          left_at: string | null
          left_by: string | null
          id: string
          joined_at: string
          organization_id: string
          passenger_count: number
          passenger_id: string
          status: string
          trip_request_id: string
        }
        Insert: {
          left_at?: string | null
          left_by?: string | null
          id?: string
          joined_at?: string
          organization_id: string
          passenger_count?: number
          passenger_id: string
          status?: string
          trip_request_id: string
        }
        Update: {
          left_at?: string | null
          left_by?: string | null
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
          allow_carpool: boolean
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
          allow_carpool?: boolean
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
          allow_carpool?: boolean
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
          enabled: boolean
          lifecycle_version: number
          energy_type: Database["public"]["Enums"]["energy_type"]
          id: string
          name: string
          organization_id: string
          passenger_capacity: number
          supports_cargo: boolean
        }
        Insert: {
          enabled?: boolean
          lifecycle_version?: number
          energy_type: Database["public"]["Enums"]["energy_type"]
          id?: string
          name: string
          organization_id: string
          passenger_capacity: number
          supports_cargo?: boolean
        }
        Update: {
          enabled?: boolean
          lifecycle_version?: number
          energy_type?: Database["public"]["Enums"]["energy_type"]
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
          enabled: boolean
          lifecycle_version: number
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          enabled?: boolean
          lifecycle_version?: number
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          enabled?: boolean
          lifecycle_version?: number
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
          archived_at: string | null
          archived_by: string | null
          archive_reason: string | null
          pre_archive_status: Database["public"]["Enums"]["vehicle_status"] | null
          lifecycle_version: number
          vin: string | null
          next_service_date: string | null
          battery_level_percent: number | null
          category_id: string
          color: string | null
          created_at: string
          current_location_id: string | null
          documentation_valid: boolean
          estimated_range_km: number
          fuel_level_percent: number | null
          has_blocking_damage: boolean
          home_location_id: string | null
          id: string
          is_clean_exterior: boolean
          is_clean_interior: boolean
          missing_safety_equipment: string[]
          name: string | null
          next_service_odometer_km: number | null
          odometer_km: number
          organization_id: string
          photo_storage_path: string | null
          plate: string
          pre_block_status: Database["public"]["Enums"]["vehicle_status"] | null
          status: Database["public"]["Enums"]["vehicle_status"]
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          archived_by?: string | null
          archive_reason?: string | null
          pre_archive_status?: Database["public"]["Enums"]["vehicle_status"] | null
          lifecycle_version?: number
          vin?: string | null
          next_service_date?: string | null
          battery_level_percent?: number | null
          category_id: string
          color?: string | null
          created_at?: string
          current_location_id?: string | null
          documentation_valid?: boolean
          estimated_range_km?: number
          fuel_level_percent?: number | null
          has_blocking_damage?: boolean
          home_location_id?: string | null
          id?: string
          is_clean_exterior?: boolean
          is_clean_interior?: boolean
          missing_safety_equipment?: string[]
          name?: string | null
          next_service_odometer_km?: number | null
          odometer_km?: number
          organization_id: string
          photo_storage_path?: string | null
          plate: string
          pre_block_status?:
            | Database["public"]["Enums"]["vehicle_status"]
            | null
          status?: Database["public"]["Enums"]["vehicle_status"]
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          archived_by?: string | null
          archive_reason?: string | null
          pre_archive_status?: Database["public"]["Enums"]["vehicle_status"] | null
          lifecycle_version?: number
          vin?: string | null
          next_service_date?: string | null
          battery_level_percent?: number | null
          category_id?: string
          color?: string | null
          created_at?: string
          current_location_id?: string | null
          documentation_valid?: boolean
          estimated_range_km?: number
          fuel_level_percent?: number | null
          has_blocking_damage?: boolean
          home_location_id?: string | null
          id?: string
          is_clean_exterior?: boolean
          is_clean_interior?: boolean
          missing_safety_equipment?: string[]
          name?: string | null
          next_service_odometer_km?: number | null
          odometer_km?: number
          organization_id?: string
          photo_storage_path?: string | null
          plate?: string
          pre_block_status?:
            | Database["public"]["Enums"]["vehicle_status"]
            | null
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
          assigned_to: string | null
          created_at: string
          id: string
          notes: string | null
          organization_id: string
          priority: string
          resolved_at: string | null
          source_inspection_id: string | null
          status: Database["public"]["Enums"]["workflow_task_status"]
          type: Database["public"]["Enums"]["workflow_task_type"]
          vehicle_id: string
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id: string
          priority?: string
          resolved_at?: string | null
          source_inspection_id?: string | null
          status?: Database["public"]["Enums"]["workflow_task_status"]
          type: Database["public"]["Enums"]["workflow_task_type"]
          vehicle_id: string
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string
          priority?: string
          resolved_at?: string | null
          source_inspection_id?: string | null
          status?: Database["public"]["Enums"]["workflow_task_status"]
          type?: Database["public"]["Enums"]["workflow_task_type"]
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
      fm_managed_vehicles: { Row:Database["public"]["Tables"]["vehicles"]["Row"]; Relationships:Database["public"]["Tables"]["vehicles"]["Relationships"] };
      fm_managed_reservations: { Row:Database["public"]["Tables"]["reservations"]["Row"]; Relationships:Database["public"]["Tables"]["reservations"]["Relationships"] };
      fm_managed_trip_requests: { Row:Database["public"]["Tables"]["trip_requests"]["Row"]; Relationships:Database["public"]["Tables"]["trip_requests"]["Relationships"] };
      fm_managed_inspections: { Row:Database["public"]["Tables"]["inspections"]["Row"]; Relationships:Database["public"]["Tables"]["inspections"]["Relationships"] };
      fm_managed_workflow_tasks: { Row:Database["public"]["Tables"]["workflow_tasks"]["Row"]; Relationships:Database["public"]["Tables"]["workflow_tasks"]["Relationships"] };
      fm_managed_carpool_offers: { Row:Database["public"]["Tables"]["carpool_offers"]["Row"]; Relationships:Database["public"]["Tables"]["carpool_offers"]["Relationships"] };
      fm_managed_people: {Row:Pick<Database["public"]["Tables"]["profiles"]["Row"],"id"|"organization_id"|"full_name"|"role">;Relationships:Database["public"]["Tables"]["profiles"]["Relationships"]};
      fm_managed_ride_requests: {Row:Pick<Database["public"]["Tables"]["carpool_ride_requests"]["Row"],"id"|"organization_id"|"carpool_offer_id"|"rider_id"|"status"|"requested_seats"|"created_at">;Relationships:Database["public"]["Tables"]["carpool_ride_requests"]["Relationships"]};
    }
    Functions: {
      fm_operation_exception: {Args:{p_reservation_id:string;p_outcome:string;p_reason:string;p_request_id:string};Returns:Json};

      fm_update_vehicle: {Args:{p_id:string;p_payload:Json;p_correction_reason?:string};Returns:undefined};
      fm_photo_info: {Args:{p_id:string};Returns:Json};
      fm_photo_restart: {Args:{p_id:string};Returns:undefined};
      fm_not_departed_reservations: {Args:{p_ids:string[]};Returns:string[]};
      fm_claim_workflow_task: {Args:{p_task_id:string};Returns:string};
      fm_photo_attest: { Args:{p_id:string;p_actor:string;p_sha256:string;p_size:number;p_mime:string;p_path:string}; Returns:undefined };

      fm_photo_begin: { Args: {p_kind:string;p_target:string;p_angle:Database["public"]["Enums"]["photo_angle"]|null;p_sha256:string;p_size:number;p_mime:string}; Returns: Json };
      fm_photo_finalize: { Args: {p_id:string; p_sha256?:string}; Returns: undefined };
      fm_photo_pending: { Args: Record<PropertyKey,never>; Returns: Json };
      fm_availability_windows: { Args: {p_from?:string}; Returns: {vehicle_id:string;start_at:string;end_at:string;kind:string}[] };

      fm_equipment_profile_save: {Args:{p_kind:string;p_target_id:string;p_required_ids:string[];p_optional_ids:string[];p_enabled:boolean;p_version:number;p_reason:string;p_request_id:string};Returns:Json};
      fm_equipment_vehicle_snapshot: {Args:{p_vehicle_id:string};Returns:Json};
      fm_prepare_equipment_checklist: {Args:{p_reservation_id:string};Returns:Json};
      leave_legacy_participation: {Args:{p_id:string};Returns:undefined};
      fm_fleet_lifecycle: {Args:{p_kind:string;p_id:string;p_enabled:boolean;p_version:number;p_reason:string;p_request_id:string};Returns:Json};
      fm_order_adjustment_workspace: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_order_adjustment_command: {Args:{p_command:string;p_payload:Json;p_request_id:string};Returns:Json};
      fm_management_unit_dimension: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_export_my_data: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_incident_workspace: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_incident_command: {Args:{p_command:string;p_payload:Json;p_request_id:string};Returns:Json};
      fm_fleet_archive_workspace: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_vehicle_dossier: {Args:{p_vehicle_id:string};Returns:Json};
      fm_document_begin: {Args:{p_kind:string;p_target_id:string;p_category:string;p_filename:string;p_mime:string;p_size:number;p_sha256:string;p_request_id:string};Returns:Json};
      fm_document_finalize: {Args:{p_id:string};Returns:Json};
      fm_document_list: {Args:{p_kind:string;p_target_id:string};Returns:Json};
      fm_document_get: {Args:{p_id:string};Returns:Json};
      fm_document_invalidate: {Args:{p_id:string;p_version:number;p_reason:string;p_request_id:string};Returns:Json};
      fm_budget_approval_queue: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_has_budget_approval_assignment: {Args:Record<PropertyKey,never>;Returns:boolean};
      fm_budget_approve: {Args:{p_order_id:string;p_version:number;p_request_id:string};Returns:Json};
      fm_maintenance_policy_save: {Args:{p_unit_id:string;p_mode:string;p_approver_ids:string[];p_superior_ids:string[];p_version:number;p_reason:string;p_request_id:string};Returns:Json};
      fm_maintenance_policy_snapshot: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_my_management_scope: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_manager_scope_admin_snapshot: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_manager_scope_command: {Args:{p_user_id:string;p_mode:string;p_unit_ids:string[];p_version:number;p_reason:string;p_request_id:string};Returns:Json};
      fm_management_create_vehicle: {Args:{p_unit_id:string|null;p_values:Json};Returns:string};
      fm_can_manage_vehicle: {Args:{p_vehicle_id:string};Returns:boolean};
      fm_has_key_custody: {Args:Record<PropertyKey,never>;Returns:boolean};
      fm_unit_admin_snapshot: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_key_workspace: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_key_management_workspace: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_unit_admin_command: {Args:{p_command:string;p_payload:Json;p_request_id:string};Returns:Json};
      fm_key_command: {Args:{p_reservation_id:string;p_kind:string;p_reason:string|null;p_request_id:string};Returns:Json};
      fm_my_privacy_requests: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_ai_policy_read: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_admin_snapshot: {Args:Record<PropertyKey,never>;Returns:Json};
      fm_admin_command: {Args:{p_command:string;p_payload:Json;p_request_id:string};Returns:Json};
      fm_privacy_submit: {Args:{p_kind:string;p_summary:string;p_request_id:string};Returns:string};

      fm_v3_command: { Args: { p_command: string; p_payload: Json; p_request_id: string }; Returns: Json };
      fm_v3_snapshot: { Args: Record<PropertyKey, never>; Returns: Json };
      fm_checklist_state: { Args: { p_reservation_id: string }; Returns: Json };
      fm_gate_checklist_states: { Args: { p_reservation_ids: string[] }; Returns: Json };
      fm_my_checklist_states: { Args: { p_reservation_ids: string[] }; Returns: Json };
      fm_claim_return_notice: { Args: { p_reservation_id: string }; Returns: boolean };
      fm_account_enabled: { Args: Record<PropertyKey, never>; Returns: boolean };
      fm_member_access_snapshot: { Args: Record<PropertyKey, never>; Returns: Json };
      fm_member_access_command: { Args: { p_user_id: string; p_enabled: boolean; p_version: number; p_reason: string; p_request_id: string }; Returns: Json };

      // Phase C7 (0063): privacy definer functions.
      host_ride_request_places: {
        Args: { p_trip_request_id: string }
        Returns: {
          request_id: string
          rider_id: string
          status: string
          pickup_label: string | null
          dropoff_label: string | null
          is_exact: boolean
        }[]
      }
      get_my_license: {
        Args: Record<PropertyKey, never>
        Returns: {
          drivers_license_number: string | null
          drivers_license_category: string | null
          drivers_license_expiration: string | null
          driver_authorized: boolean
        }[]
      }
      apply_ai_license_read: {
        Args: {
          p_user_id: string
          p_full_name: string
          p_number: string
          p_category: string
          p_expiration: string
          p_authorized: boolean
        }
        Returns: undefined
      }
      reset_ai_license: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      list_member_license_sources: {
        Args: Record<PropertyKey, never>
        Returns: {
          id: string
          drivers_license_expiration_source: string | null
        }[]
      }
      list_member_licenses: {
        Args: Record<PropertyKey, never>
        Returns: {
          id: string
          drivers_license_number: string | null
          drivers_license_category: string | null
          drivers_license_expiration: string | null
          driver_authorized: boolean
        }[]
      }
      get_vehicle_busy_windows: {
        Args: { p_from?: string }
        Returns: {
          vehicle_id: string
          start_at: string
          end_at: string
          status: Database["public"]["Enums"]["reservation_status"]
        }[]
      }
      accept_carpool_ride_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
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
      cancel_carpool_ride_request: {
        Args: { p_request_id: string }
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
      create_carpool_ride_request_as_rider: {
        Args: {
          p_client_request_id: string
          p_dropoff: Json
          p_match_additional_distance_km: number
          p_match_additional_time_min: number
          p_offer_id: string
          p_pickup: Json
          p_requested_departure_at: string
          p_rider_id: string
          p_seats: number
        }
        Returns: string
      }
      disable_carpool_offer: {
        Args: { p_offer_id: string }
        Returns: undefined
      }
      enable_carpool_offer: {
        Args: { p_seats: number; p_trip_request_id: string }
        Returns: string
      }
      expire_stale_carpool_requests: {
        Args: never
        Returns: number
      }
      fm_release_expired_reservations: {
        Args: { p_organization_id?: string; p_limit?: number }
        Returns: Json
      }
      purge_old_carpool_locations: {
        Args: { p_days?: number }
        Returns: number
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
      record_geo_provider_call_outcome: {
        Args: {
          p_day: string
          p_latency_ms: number
          p_ok: boolean
          p_organization_id: string
          p_provider_call_kind: string
        }
        Returns: undefined
      }
      consume_user_geo_quota: {
        Args: {
          p_daily_cap: number
          p_kind: string
          p_user_id: string
        }
        Returns: boolean
      }
      consume_route_map_view: {
        Args: {
          p_daily_cap: number
          p_user_id: string
        }
        Returns: boolean
      }
      increment_geo_provider_quota_counter: {
        Args: {
          p_day: string
          p_organization_id: string
          p_provider_call_kind: string
        }
        Returns: undefined
      }
      create_vehicle_reservation: {
        Args: {
          p_allow_carpool?: boolean
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
          p_battery_level_percent: number | null
          p_damage_notes: string | null
          p_fuel_level_percent: number | null
          p_has_damage: boolean
          p_is_dirty_exterior: boolean | null
          p_is_dirty_interior: boolean | null
          p_missing_safety_equipment: string[] | null
          p_odometer_km: number | null
          p_reservation_id: string
          p_role: Database["public"]["Enums"]["inspection_role"]
        }
        Returns: string
      }
      reject_carpool_ride_request: {
        Args: { p_reason: string; p_request_id: string }
        Returns: undefined
      }
      revalidate_carpool_matches: {
        Args: { p_trip_request_id: string }
        Returns: Json
      }
      update_carpool_offer: {
        Args: { p_offer_id: string; p_seats: number }
        Returns: undefined
      }
      record_return: {
        Args: {
          p_battery_level_percent: number | null
          p_current_location_id?: string | null
          p_damage_notes: string | null
          p_fuel_level_percent: number | null
          p_has_new_damage: boolean
          p_is_dirty_exterior: boolean | null
          p_is_dirty_interior: boolean | null
          p_missing_safety_equipment: string[] | null
          p_odometer_km: number | null
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
      energy_type: "ICE" | "PHEV" | "BEV" | "HEV"
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
      energy_type: ["ICE", "PHEV", "BEV", "HEV"],
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

