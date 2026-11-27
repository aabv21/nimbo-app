
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "agent_notes": {
                  Row: {
                    "created_at": string,"id": string,"text": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"text": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"text"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"checkins": {
                  Row: {
                    "alcohol": boolean,"created_at": string,"extra_caffeine": boolean,"local_date": string,"low_water": boolean,"period_started": boolean,"screen_heavy": boolean,"skipped_meal": boolean,"sleep_band": Database["public"]['Enums']["sleep_band"] | null,"sleep_quality": Database["public"]['Enums']["sleep_quality"] | null,"stress": Database["public"]['Enums']["stress_level"] | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "alcohol"?: boolean,"created_at"?: string,"extra_caffeine"?: boolean,"local_date": string,"low_water"?: boolean,"period_started"?: boolean,"screen_heavy"?: boolean,"skipped_meal"?: boolean,"sleep_band"?: Database["public"]['Enums']["sleep_band"] | null,"sleep_quality"?: Database["public"]['Enums']["sleep_quality"] | null,"stress"?: Database["public"]['Enums']["stress_level"] | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "alcohol"?: boolean,"created_at"?: string,"extra_caffeine"?: boolean,"local_date"?: string,"low_water"?: boolean,"period_started"?: boolean,"screen_heavy"?: boolean,"skipped_meal"?: boolean,"sleep_band"?: Database["public"]['Enums']["sleep_band"] | null,"sleep_quality"?: Database["public"]['Enums']["sleep_quality"] | null,"stress"?: Database["public"]['Enums']["stress_level"] | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"doses": {
                  Row: {
                    "created_at": string,"episode_id": string | null,"helped": boolean | null,"id": string,"medication_id": string,"taken_at": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"episode_id"?: string | null,"helped"?: boolean | null,"id": string,"medication_id": string,"taken_at": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"episode_id"?: string | null,"helped"?: boolean | null,"id"?: string,"medication_id"?: string,"taken_at"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "doses_episode_id_fkey"
      columns: ["episode_id"]
isOneToOne: false
      referencedRelation: "episodes"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "doses_medication_id_fkey"
      columns: ["medication_id"]
isOneToOne: false
      referencedRelation: "medications"
      referencedColumns: ["id"]
    }
                  ]
                },"entitlements": {
                  Row: {
                    "created_at": string,"granted": boolean,"granted_note": string | null,"granted_until": string | null,"purchase_active": boolean,"purchase_expires_at": string | null,"purchase_source": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"granted"?: boolean,"granted_note"?: string | null,"granted_until"?: string | null,"purchase_active"?: boolean,"purchase_expires_at"?: string | null,"purchase_source"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"granted"?: boolean,"granted_note"?: string | null,"granted_until"?: string | null,"purchase_active"?: boolean,"purchase_expires_at"?: string | null,"purchase_source"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"episodes": {
                  Row: {
                    "condition": string,"created_at": string,"debriefed_at": string | null,"did_not_help": (string)[],"ended_at": string | null,"helped": (string)[],"id": string,"intensity": number | null,"notes": string | null,"pain_areas": (string)[],"reliefs": (string)[],"source": Database["public"]['Enums']["episode_source"],"started_at": string,"symptoms": (string)[],"triggers": (string)[],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "condition"?: string,"created_at"?: string,"debriefed_at"?: string | null,"did_not_help"?: (string)[],"ended_at"?: string | null,"helped"?: (string)[],"id": string,"intensity"?: number | null,"notes"?: string | null,"pain_areas"?: (string)[],"reliefs"?: (string)[],"source"?: Database["public"]['Enums']["episode_source"],"started_at": string,"symptoms"?: (string)[],"triggers"?: (string)[],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "condition"?: string,"created_at"?: string,"debriefed_at"?: string | null,"did_not_help"?: (string)[],"ended_at"?: string | null,"helped"?: (string)[],"id"?: string,"intensity"?: number | null,"notes"?: string | null,"pain_areas"?: (string)[],"reliefs"?: (string)[],"source"?: Database["public"]['Enums']["episode_source"],"started_at"?: string,"symptoms"?: (string)[],"triggers"?: (string)[],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"medications": {
                  Row: {
                    "archived_at": string | null,"class": Database["public"]['Enums']["medication_class"],"created_at": string,"dose_text": string | null,"form": Database["public"]['Enums']["medication_form"],"id": string,"kind": Database["public"]['Enums']["medication_kind"],"min_interval_minutes": number | null,"name": string,"schedule": Database["public"]['Enums']["medication_schedule"] | null,"schedule_anchor": string | null,"schedule_time": string | null,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived_at"?: string | null,"class": Database["public"]['Enums']["medication_class"],"created_at"?: string,"dose_text"?: string | null,"form"?: Database["public"]['Enums']["medication_form"],"id": string,"kind": Database["public"]['Enums']["medication_kind"],"min_interval_minutes"?: number | null,"name": string,"schedule"?: Database["public"]['Enums']["medication_schedule"] | null,"schedule_anchor"?: string | null,"schedule_time"?: string | null,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "archived_at"?: string | null,"class"?: Database["public"]['Enums']["medication_class"],"created_at"?: string,"dose_text"?: string | null,"form"?: Database["public"]['Enums']["medication_form"],"id"?: string,"kind"?: Database["public"]['Enums']["medication_kind"],"min_interval_minutes"?: number | null,"name"?: string,"schedule"?: Database["public"]['Enums']["medication_schedule"] | null,"schedule_anchor"?: string | null,"schedule_time"?: string | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "adult_confirmed_at": string | null,"ai_consent_answered_at": string | null,"ai_consent_at": string | null,"ai_enabled": boolean,"boundary_accepted_at": string | null,"coarse_lat": number | null,"coarse_lon": number | null,"condition": string,"created_at": string,"known_triggers": (string)[],"language": Database["public"]['Enums']["app_language"] | null,"lock_screen_detail": boolean,"notify_daily_cap": number,"notify_end": string,"notify_start": string,"onboarding_completed_at": string | null,"priority": string | null,"reduce_motion": boolean,"theme": Database["public"]['Enums']["app_theme"],"timezone": string | null,"track_period": boolean,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "adult_confirmed_at"?: string | null,"ai_consent_answered_at"?: string | null,"ai_consent_at"?: string | null,"ai_enabled"?: boolean,"boundary_accepted_at"?: string | null,"coarse_lat"?: number | null,"coarse_lon"?: number | null,"condition"?: string,"created_at"?: string,"known_triggers"?: (string)[],"language"?: Database["public"]['Enums']["app_language"] | null,"lock_screen_detail"?: boolean,"notify_daily_cap"?: number,"notify_end"?: string,"notify_start"?: string,"onboarding_completed_at"?: string | null,"priority"?: string | null,"reduce_motion"?: boolean,"theme"?: Database["public"]['Enums']["app_theme"],"timezone"?: string | null,"track_period"?: boolean,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "adult_confirmed_at"?: string | null,"ai_consent_answered_at"?: string | null,"ai_consent_at"?: string | null,"ai_enabled"?: boolean,"boundary_accepted_at"?: string | null,"coarse_lat"?: number | null,"coarse_lon"?: number | null,"condition"?: string,"created_at"?: string,"known_triggers"?: (string)[],"language"?: Database["public"]['Enums']["app_language"] | null,"lock_screen_detail"?: boolean,"notify_daily_cap"?: number,"notify_end"?: string,"notify_start"?: string,"onboarding_completed_at"?: string | null,"priority"?: string | null,"reduce_motion"?: boolean,"theme"?: Database["public"]['Enums']["app_theme"],"timezone"?: string | null,"track_period"?: boolean,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"usage_counters": {
                  Row: {
                    "count": number,"day": string,"kind": Database["public"]['Enums']["quota_kind"],"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count": number,"day": string,"kind": Database["public"]['Enums']["quota_kind"],"user_id": string
                  }
                  Update: {
                    "count"?: number,"day"?: string,"kind"?: Database["public"]['Enums']["quota_kind"],"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_terms":
{ Args: { "p_adult": boolean,"p_boundary": boolean }; Returns: undefined
                           },
"catalog_keys":
{ Args: { "p_catalog": string }; Returns: (string)[]
                           },
"complete_onboarding":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"consume_quota":
{ Args: { "p_day": string,"p_kind": Database["public"]['Enums']["quota_kind"],"p_limit": number,"p_user_id": string }; Returns: boolean
                           },
"delete_agent_note":
{ Args: { "p_id": string }; Returns: undefined
                           },
"delete_dose":
{ Args: { "p_id": string }; Returns: undefined
                           },
"delete_episode":
{ Args: { "p_id": string }; Returns: undefined
                           },
"end_episode":
{ Args: { "p_ended_at": string,"p_id": string }; Returns: undefined
                           },
"has_premium":
{ Args: { "p_user": string }; Returns: boolean
                           },
"is_catalog_subset":
{ Args: { "p_catalog": string,"p_values": (string)[] }; Returns: boolean
                           },
"keep_alive":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"log_dose":
{ Args: { "p_episode_id"?: string,"p_id": string,"p_medication_id": string,"p_taken_at": string }; Returns: undefined
                           },
"log_episode":
{ Args: { "p_fields": Json,"p_id": string,"p_started_at": string }; Returns: undefined
                           },
"save_agent_note":
{ Args: { "p_text": string }; Returns: string
                           },
"save_checkin":
{ Args: { "p_fields": Json,"p_local_date": string }; Returns: undefined
                           },
"save_medication":
{ Args: { "p_fields": Json,"p_id": string }; Returns: undefined
                           },
"set_ai_consent":
{ Args: { "p_enabled": boolean }; Returns: undefined
                           },
"set_dose_helped":
{ Args: { "p_helped"?: boolean,"p_id": string }; Returns: undefined
                           },
"update_episode":
{ Args: { "p_fields": Json,"p_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "app_language": "en"|"es"|"pt","app_theme": "system"|"day"|"dark"|"dim","episode_source": "manual"|"voice"|"chat","medication_class": "simple_analgesic"|"triptan"|"ergot"|"opioid"|"combination_analgesic"|"gepant"|"other","medication_form": "oral"|"injection"|"nasal"|"other","medication_kind": "preventive"|"acute","medication_schedule": "daily"|"monthly"|"quarterly","quota_kind": "companion"|"dictation","sleep_band": "lt5"|"5_6"|"6_7"|"7_8"|"gt8","sleep_quality": "bad"|"ok"|"good","stress_level": "low"|"mid"|"high"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "app_language": ["en", "es", "pt"],"app_theme": ["system", "day", "dark", "dim"],"episode_source": ["manual", "voice", "chat"],"medication_class": ["simple_analgesic", "triptan", "ergot", "opioid", "combination_analgesic", "gepant", "other"],"medication_form": ["oral", "injection", "nasal", "other"],"medication_kind": ["preventive", "acute"],"medication_schedule": ["daily", "monthly", "quarterly"],"quota_kind": ["companion", "dictation"],"sleep_band": ["lt5", "5_6", "6_7", "7_8", "gt8"],"sleep_quality": ["bad", "ok", "good"],"stress_level": ["low", "mid", "high"]
          }
        }
} as const
