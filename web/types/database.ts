// Tipos generados del schema de Supabase.
// Regenerar cuando cambien las migraciones: supabase gen types typescript --local > web/types/database.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      rate_limits: {
        Row: {
          key: string;
          window_start: string;
          count: number;
        };
        Insert: {
          key: string;
          window_start?: string;
          count?: number;
        };
        Update: {
          key?: string;
          window_start?: string;
          count?: number;
        };
        Relationships: [];
      };
      refunds: {
        Row: {
          id: string;
          booking_id: string;
          payment_id: string;
          external_refund_id: string | null;
          amount_cents: number;
          currency: string;
          status: 'pending' | 'processing' | 'succeeded' | 'failed';
          reason: string | null;
          failure_reason: string | null;
          attempts: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          payment_id: string;
          external_refund_id?: string | null;
          amount_cents: number;
          currency?: string;
          status?: 'pending' | 'processing' | 'succeeded' | 'failed';
          reason?: string | null;
          failure_reason?: string | null;
          attempts?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          booking_id?: string;
          payment_id?: string;
          external_refund_id?: string | null;
          amount_cents?: number;
          currency?: string;
          status?: 'pending' | 'processing' | 'succeeded' | 'failed';
          reason?: string | null;
          failure_reason?: string | null;
          attempts?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'refunds_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'refunds_payment_id_fkey';
            columns: ['payment_id'];
            isOneToOne: false;
            referencedRelation: 'payments';
            referencedColumns: ['id'];
          },
        ];
      };
      audit_logs: {
        Row: {
          id: string;
          actor_type: 'tourist' | 'staff' | 'admin' | 'system';
          actor_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_type: 'tourist' | 'staff' | 'admin' | 'system';
          actor_id?: string | null;
          action: string;
          entity_type: string;
          entity_id: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_type?: 'tourist' | 'staff' | 'admin' | 'system';
          actor_id?: string | null;
          action?: string;
          entity_type?: string;
          entity_id?: string;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'audit_logs_actor_id_fkey';
            columns: ['actor_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      booking_access_tokens: {
        Row: {
          id: string;
          booking_id: string;
          token_hash: string;
          expires_at: string;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          booking_id: string;
          token_hash: string;
          expires_at: string;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          booking_id?: string;
          token_hash?: string;
          expires_at?: string;
          created_at?: string;
          last_used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'booking_access_tokens_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
        ];
      };
      users: {
        Row: {
          id: string;
          email: string;
          role: 'admin' | 'staff' | 'guide';
          full_name: string;
          phone: string | null;
          active: boolean;
          locale: 'es' | 'en';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          role?: 'admin' | 'staff' | 'guide';
          full_name: string;
          phone?: string | null;
          active?: boolean;
          locale?: 'es' | 'en';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          role?: 'admin' | 'staff' | 'guide';
          full_name?: string;
          phone?: string | null;
          active?: boolean;
          locale?: 'es' | 'en';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tours: {
        Row: {
          id: string;
          slug: string;
          name_es: string;
          name_en: string;
          description_es: string;
          description_en: string;
          difficulty: 'easy' | 'moderate' | 'hard';
          duration_minutes: number;
          meeting_point_es: string;
          meeting_point_en: string;
          includes_es: string;
          includes_en: string;
          min_participants: number;
          max_capacity: number;
          cover_image_url: string | null;
          status: 'active' | 'archived';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          slug: string;
          name_es: string;
          name_en: string;
          description_es: string;
          description_en: string;
          difficulty: 'easy' | 'moderate' | 'hard';
          duration_minutes: number;
          meeting_point_es: string;
          meeting_point_en: string;
          includes_es: string;
          includes_en: string;
          min_participants?: number;
          max_capacity: number;
          cover_image_url?: string | null;
          status?: 'active' | 'archived';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          slug?: string;
          name_es?: string;
          name_en?: string;
          description_es?: string;
          description_en?: string;
          difficulty?: 'easy' | 'moderate' | 'hard';
          duration_minutes?: number;
          meeting_point_es?: string;
          meeting_point_en?: string;
          includes_es?: string;
          includes_en?: string;
          min_participants?: number;
          max_capacity?: number;
          cover_image_url?: string | null;
          status?: 'active' | 'archived';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tour_pricing: {
        Row: {
          id: string;
          tour_id: string;
          ticket_type: 'adult' | 'child' | 'student';
          price_usd: number;
          season_label: string | null;
          valid_from: string | null;
          valid_until: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          ticket_type: 'adult' | 'child' | 'student';
          price_usd: number;
          season_label?: string | null;
          valid_from?: string | null;
          valid_until?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          ticket_type?: 'adult' | 'child' | 'student';
          price_usd?: number;
          season_label?: string | null;
          valid_from?: string | null;
          valid_until?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_pricing_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_schedules: {
        Row: {
          id: string;
          tour_id: string;
          day_of_week: number;
          start_time: string;
          capacity: number;
          valid_from: string;
          valid_until: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          day_of_week: number;
          start_time: string;
          capacity: number;
          valid_from?: string;
          valid_until?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          day_of_week?: number;
          start_time?: string;
          capacity?: number;
          valid_from?: string;
          valid_until?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_schedules_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_instances: {
        Row: {
          id: string;
          tour_id: string;
          schedule_id: string;
          starts_at: string;
          ends_at: string;
          capacity_total: number;
          capacity_reserved: number;
          status: 'available' | 'full' | 'cancelled';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tour_id: string;
          schedule_id: string;
          starts_at: string;
          ends_at: string;
          capacity_total: number;
          capacity_reserved?: number;
          status?: 'available' | 'full' | 'cancelled';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tour_id?: string;
          schedule_id?: string;
          starts_at?: string;
          ends_at?: string;
          capacity_total?: number;
          capacity_reserved?: number;
          status?: 'available' | 'full' | 'cancelled';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_instances_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tour_instances_schedule_id_fkey';
            columns: ['schedule_id'];
            isOneToOne: false;
            referencedRelation: 'tour_schedules';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_holds: {
        Row: {
          id: string;
          tour_instance_id: string;
          session_token: string;
          held_seats: number;
          status: 'active' | 'released' | 'expired' | 'converted' | 'paying';
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_instance_id: string;
          session_token: string;
          held_seats: number;
          status?: 'active' | 'released' | 'expired' | 'converted' | 'paying';
          expires_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_instance_id?: string;
          session_token?: string;
          held_seats?: number;
          status?: 'active' | 'released' | 'expired' | 'converted' | 'paying';
          expires_at?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_holds_tour_instance_id_fkey';
            columns: ['tour_instance_id'];
            isOneToOne: false;
            referencedRelation: 'tour_instances';
            referencedColumns: ['id'];
          },
        ];
      };
      bookings: {
        Row: {
          id: string;
          tour_instance_id: string;
          hold_id: string | null;
          customer_name: string;
          customer_email: string;
          tickets_adult: number;
          tickets_child: number;
          tickets_student: number;
          total_amount_cents: number;
          currency: string;
          status:
            | 'pending_payment'
            | 'confirmed'
            | 'cancelled'
            | 'refunded'
            | 'payment_mismatch'
            | 'overbooked_refunded';
          locale: 'es' | 'en';
          checked_in_at: string | null;
          checked_in_by: string | null;
          consent_at: string | null;
          consent_version: string | null;
          anonymized_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tour_instance_id: string;
          hold_id?: string | null;
          customer_name: string;
          customer_email: string;
          tickets_adult?: number;
          tickets_child?: number;
          tickets_student?: number;
          total_amount_cents: number;
          currency?: string;
          status?:
            | 'pending_payment'
            | 'confirmed'
            | 'cancelled'
            | 'refunded'
            | 'payment_mismatch'
            | 'overbooked_refunded';
          locale?: 'es' | 'en';
          checked_in_at?: string | null;
          checked_in_by?: string | null;
          consent_at?: string | null;
          consent_version?: string | null;
          anonymized_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tour_instance_id?: string;
          hold_id?: string | null;
          customer_name?: string;
          customer_email?: string;
          tickets_adult?: number;
          tickets_child?: number;
          tickets_student?: number;
          total_amount_cents?: number;
          currency?: string;
          status?:
            | 'pending_payment'
            | 'confirmed'
            | 'cancelled'
            | 'refunded'
            | 'payment_mismatch'
            | 'overbooked_refunded';
          locale?: 'es' | 'en';
          checked_in_at?: string | null;
          checked_in_by?: string | null;
          consent_at?: string | null;
          consent_version?: string | null;
          anonymized_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bookings_tour_instance_id_fkey';
            columns: ['tour_instance_id'];
            isOneToOne: false;
            referencedRelation: 'tour_instances';
            referencedColumns: ['id'];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          booking_id: string;
          external_provider: string;
          external_payment_id: string;
          amount_cents: number;
          currency: string;
          status: 'pending' | 'succeeded' | 'failed' | 'refunded';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          booking_id: string;
          external_provider?: string;
          external_payment_id: string;
          amount_cents: number;
          currency?: string;
          status?: 'pending' | 'succeeded' | 'failed' | 'refunded';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          booking_id?: string;
          external_provider?: string;
          external_payment_id?: string;
          amount_cents?: number;
          currency?: string;
          status?: 'pending' | 'succeeded' | 'failed' | 'refunded';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'payments_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
        ];
      };
      processed_webhook_events: {
        Row: { id: string; processed_at: string };
        Insert: { id: string; processed_at?: string };
        Update: { id?: string; processed_at?: string };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          booking_id: string | null;
          tour_instance_id: string | null;
          guide_id: string | null;
          kind:
            | 'booking_confirmation'
            | 'reminder_24h'
            | 'guide_assignment'
            | 'cancellation_confirmation'
            | 'refund_confirmation'
            | 'overbooked_refunded';
          channel: 'email';
          recipient_email: string;
          locale: 'es' | 'en';
          status: 'pending' | 'sent' | 'failed' | 'cancelled';
          scheduled_for: string;
          attempts: number;
          provider: string | null;
          provider_message_id: string | null;
          last_error: string | null;
          sent_at: string | null;
          cancelled_reason: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          booking_id?: string | null;
          tour_instance_id?: string | null;
          guide_id?: string | null;
          kind:
            | 'booking_confirmation'
            | 'reminder_24h'
            | 'guide_assignment'
            | 'cancellation_confirmation'
            | 'refund_confirmation'
            | 'overbooked_refunded';
          channel?: 'email';
          recipient_email: string;
          locale: 'es' | 'en';
          status?: 'pending' | 'sent' | 'failed' | 'cancelled';
          scheduled_for: string;
          attempts?: number;
          provider?: string | null;
          provider_message_id?: string | null;
          last_error?: string | null;
          sent_at?: string | null;
          cancelled_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          booking_id?: string | null;
          tour_instance_id?: string | null;
          guide_id?: string | null;
          kind?:
            | 'booking_confirmation'
            | 'reminder_24h'
            | 'guide_assignment'
            | 'cancellation_confirmation'
            | 'refund_confirmation'
            | 'overbooked_refunded';
          channel?: 'email';
          recipient_email?: string;
          locale?: 'es' | 'en';
          status?: 'pending' | 'sent' | 'failed' | 'cancelled';
          scheduled_for?: string;
          attempts?: number;
          provider?: string | null;
          provider_message_id?: string | null;
          last_error?: string | null;
          sent_at?: string | null;
          cancelled_reason?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'notifications_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_tour_instance_id_fkey';
            columns: ['tour_instance_id'];
            isOneToOne: false;
            referencedRelation: 'tour_instances';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_guide_id_fkey';
            columns: ['guide_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_instance_guides: {
        Row: {
          tour_instance_id: string;
          guide_id: string;
          assigned_at: string;
          assigned_by: string | null;
        };
        Insert: {
          tour_instance_id: string;
          guide_id: string;
          assigned_at?: string;
          assigned_by?: string | null;
        };
        Update: {
          tour_instance_id?: string;
          guide_id?: string;
          assigned_at?: string;
          assigned_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_instance_guides_tour_instance_id_fkey';
            columns: ['tour_instance_id'];
            isOneToOne: false;
            referencedRelation: 'tour_instances';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tour_instance_guides_guide_id_fkey';
            columns: ['guide_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
      guide_access_tokens: {
        Row: {
          id: string;
          guide_id: string;
          token_hash: string;
          expires_at: string;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          guide_id: string;
          token_hash: string;
          expires_at: string;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          guide_id?: string;
          token_hash?: string;
          expires_at?: string;
          created_at?: string;
          last_used_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'guide_access_tokens_guide_id_fkey';
            columns: ['guide_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_hold_atomic: {
        Args: { p_instance_id: string; p_seats: number; p_session: string };
        Returns: {
          id: string;
          tour_instance_id: string;
          session_token: string;
          held_seats: number;
          status: 'active' | 'released' | 'expired' | 'converted' | 'paying';
          expires_at: string;
          created_at: string;
        };
      };
      confirm_booking: {
        Args: {
          p_booking_id: string;
          p_external_payment_id: string;
          p_total_seats: number;
          p_event_id?: string | null;
          p_paid_amount_cents?: number | null;
          p_paid_currency?: string | null;
        };
        Returns: void;
      };
      cancel_booking: {
        Args: {
          p_booking_id: string;
          p_actor_type: string;
          p_refund_amount_cents: number;
          p_actor_id?: string;
        };
        Returns: void;
      };
      flag_payment_mismatch: {
        Args: {
          p_booking_id: string;
          p_paid_amount_cents: number;
          p_paid_currency: string;
          p_source: string;
        };
        Returns: boolean;
      };
      cancel_stale_pending_booking: {
        Args: { p_booking_id: string; p_reason: string };
        Returns: boolean;
      };
      anonymize_booking_pii_by_email: {
        Args: { p_email: string; p_actor_id: string };
        Returns: { anonymized_count: number; deleted_count: number }[];
      };
      anonymize_bookings_past_retention: {
        Args: { p_cutoff: string };
        Returns: number;
      };
      purge_unpaid_bookings: {
        Args: { p_cutoff: string };
        Returns: number;
      };
      purge_expired_access_tokens: {
        Args: { p_cutoff: string };
        Returns: number;
      };
      purge_old_notifications: {
        Args: { p_cutoff: string };
        Returns: number;
      };
      report_revenue: {
        Args: { p_from: string; p_to: string };
        Returns: {
          tour_id: string;
          name_es: string;
          name_en: string;
          gross_cents: number;
          refunded_cents: number;
          net_cents: number;
          currency: string;
        }[];
      };
      report_occupancy: {
        Args: { p_from: string; p_to: string };
        Returns: {
          tour_id: string;
          name_es: string;
          name_en: string;
          bookings_count: number;
          tickets_sold: number;
          capacity_total: number;
          occupancy_pct: number | null;
          no_show_count: number;
          past_bookings_count: number;
        }[];
      };
      report_refunds_summary: {
        Args: { p_from: string; p_to: string };
        Returns: {
          refunds_count: number;
          refunds_amount_cents: number;
          cancelled_count: number;
          valid_bookings_count: number;
          currency: string;
        }[];
      };
      check_rate_limit: {
        Args: { p_key: string; p_limit: number; p_window_seconds: number };
        Returns: { allowed: boolean; retry_after: number }[];
      };
    };
    Enums: {
      user_role: 'admin' | 'staff' | 'guide';
      tour_status: 'active' | 'archived';
      ticket_type: 'adult' | 'child' | 'student';
    };
    CompositeTypes: Record<string, never>;
  };
};

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];
