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
          auto_cancel_below_minimum: boolean;
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
          auto_cancel_below_minimum?: boolean;
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
          auto_cancel_below_minimum?: boolean;
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
          minimum_charge_triggered_at: string | null;
          staff_decision_required_at: string | null;
          minimum_resolved_at: string | null;
          minimum_resolved_by: string | null;
          minimum_resolution:
            | 'reached'
            | 'staff_confirmed'
            | 'staff_cancelled'
            | 'auto_cancelled'
            | null;
          min_participants_at_trigger: number | null;
          seats_at_trigger: number | null;
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
          minimum_charge_triggered_at?: string | null;
          staff_decision_required_at?: string | null;
          minimum_resolved_at?: string | null;
          minimum_resolved_by?: string | null;
          minimum_resolution?:
            | 'reached'
            | 'staff_confirmed'
            | 'staff_cancelled'
            | 'auto_cancelled'
            | null;
          min_participants_at_trigger?: number | null;
          seats_at_trigger?: number | null;
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
          minimum_charge_triggered_at?: string | null;
          staff_decision_required_at?: string | null;
          minimum_resolved_at?: string | null;
          minimum_resolved_by?: string | null;
          minimum_resolution?:
            | 'reached'
            | 'staff_confirmed'
            | 'staff_cancelled'
            | 'auto_cancelled'
            | null;
          min_participants_at_trigger?: number | null;
          seats_at_trigger?: number | null;
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
          {
            foreignKeyName: 'tour_instances_minimum_resolved_by_fkey';
            columns: ['minimum_resolved_by'];
            isOneToOne: false;
            referencedRelation: 'users';
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
          customer_external_id: string | null;
          customer_cleaned_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          tour_instance_id: string;
          session_token: string;
          held_seats: number;
          status?: 'active' | 'released' | 'expired' | 'converted' | 'paying';
          expires_at?: string;
          customer_external_id?: string | null;
          customer_cleaned_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          tour_instance_id?: string;
          session_token?: string;
          held_seats?: number;
          status?: 'active' | 'released' | 'expired' | 'converted' | 'paying';
          expires_at?: string;
          customer_external_id?: string | null;
          customer_cleaned_at?: string | null;
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
            | 'pending_minimum'
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
          payment_method_id: string | null;
          customer_external_id: string | null;
          card_brand: string | null;
          card_last4: string | null;
          card_exp_month: number | null;
          card_exp_year: number | null;
          charge_attempts: number;
          charge_next_attempt_at: string | null;
          charge_started_at: string | null;
          charge_last_error: string | null;
          awaiting_action_until: string | null;
          recovery_deadline: string | null;
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
            | 'pending_minimum'
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
          payment_method_id?: string | null;
          customer_external_id?: string | null;
          card_brand?: string | null;
          card_last4?: string | null;
          card_exp_month?: number | null;
          card_exp_year?: number | null;
          charge_attempts?: number;
          charge_next_attempt_at?: string | null;
          charge_started_at?: string | null;
          charge_last_error?: string | null;
          awaiting_action_until?: string | null;
          recovery_deadline?: string | null;
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
            | 'pending_minimum'
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
          payment_method_id?: string | null;
          customer_external_id?: string | null;
          card_brand?: string | null;
          card_last4?: string | null;
          card_exp_month?: number | null;
          card_exp_year?: number | null;
          charge_attempts?: number;
          charge_next_attempt_at?: string | null;
          charge_started_at?: string | null;
          charge_last_error?: string | null;
          awaiting_action_until?: string | null;
          recovery_deadline?: string | null;
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
          failed_at: string | null;
          provider_closed_at: string | null;
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
          failed_at?: string | null;
          provider_closed_at?: string | null;
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
          failed_at?: string | null;
          provider_closed_at?: string | null;
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
            | 'overbooked_refunded'
            | 'booking_reserved'
            | 'departure_cancelled_minimum'
            | 'charge_failed_action_required_1'
            | 'charge_failed_action_required_2'
            | 'charge_failed_action_required_3'
            | 'charge_requires_action';
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
            | 'overbooked_refunded'
            | 'booking_reserved'
            | 'departure_cancelled_minimum'
            | 'charge_failed_action_required_1'
            | 'charge_failed_action_required_2'
            | 'charge_failed_action_required_3'
            | 'charge_requires_action';
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
            | 'overbooked_refunded'
            | 'booking_reserved'
            | 'departure_cancelled_minimum'
            | 'charge_failed_action_required_1'
            | 'charge_failed_action_required_2'
            | 'charge_failed_action_required_3'
            | 'charge_requires_action';
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
      business_settings: {
        Row: {
          id: number;
          minimum_decision_window_hours: number;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: number;
          minimum_decision_window_hours?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          id?: number;
          minimum_decision_window_hours?: number;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'business_settings_updated_by_fkey';
            columns: ['updated_by'];
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
          customer_external_id: string | null;
          customer_cleaned_at: string | null;
          created_at: string;
        };
      };
      confirm_booking: {
        Args: {
          p_booking_id: string;
          p_external_payment_id: string;
          /** DEPRECATED (spec 0028): la RPC deriva los asientos de la reserva; se ignora. */
          p_total_seats?: number | null;
          p_event_id?: string | null;
          p_paid_amount_cents?: number | null;
          p_paid_currency?: string | null;
        };
        Returns:
          | 'confirmed'
          | 'confirmed_unclaimed'
          | 'already_processed'
          | 'late_payment_refunded'
          | 'late_payment_refund_blocked'
          | 'duplicate_payment'
          | 'overbooked_refunded'
          | 'payment_mismatch'
          | 'ignored';
      };
      create_deferred_booking: {
        Args: {
          p_hold_id: string;
          p_session_token: string;
          p_customer_name: string;
          p_customer_email: string;
          p_locale: string;
          p_tickets_adult: number;
          p_tickets_child: number;
          p_tickets_student: number;
          p_total_amount_cents: number;
          p_currency: string;
          p_consent_version: string;
          p_payment_method_id: string;
          p_customer_external_id: string;
          p_card_brand: string;
          p_card_last4: string;
          p_card_exp_month: number;
          p_card_exp_year: number;
        };
        Returns: string;
      };
      charge_booking_start: {
        Args: {
          p_booking_id: string;
          p_external_payment_id: string;
          p_payment_method_id: string;
          p_actor_id?: string | null;
        };
        Returns:
          | 'started'
          | 'not_chargeable'
          | 'departure_unavailable'
          | 'recovery_expired'
          | 'retry_too_soon'
          | 'payment_method_changed'
          | 'intent_mismatch';
      };
      charge_attempt_failed: {
        Args: {
          p_booking_id: string;
          p_external_payment_id: string;
          p_error_code: string;
          p_intent_terminal: boolean;
        };
        Returns: boolean;
      };
      charge_requires_action: {
        Args: { p_booking_id: string; p_external_payment_id: string };
        Returns: boolean;
      };
      close_pending_payment: {
        Args: { p_booking_id: string; p_external_payment_id: string };
        Returns: boolean;
      };
      cancel_charge_in_flight: {
        Args: {
          p_booking_id: string;
          p_reason: 'action_expired' | 'recovery_expired' | 'departure_started';
        };
        Returns: boolean;
      };
      cancel_unpaid_booking: {
        Args: {
          p_booking_id: string;
          p_actor_id: string | null;
          p_reason: 'customer_request' | 'staff_request' | 'recovery_expired' | 'departure_started';
        };
        Returns: 'cancelled' | 'charge_in_flight' | 'not_cancellable';
      };
      update_booking_payment_method: {
        Args: {
          p_booking_id: string;
          p_customer_external_id: string;
          p_payment_method_id: string;
          p_card_brand: string;
          p_card_last4: string;
          p_card_exp_month: number;
          p_card_exp_year: number;
        };
        Returns:
          | 'updated'
          | 'not_updatable'
          | 'customer_mismatch'
          | 'update_limit_reached'
          | 'recovery_expired'
          | 'card_data_invalid'
          | 'card_expires_before_departure';
      };
      mark_payment_provider_closed: {
        Args: { p_payment_id: string; p_actor_id: string };
        Returns: boolean;
      };
      record_intent_closed: {
        Args: { p_payment_id: string; p_intent_status: 'canceled' | 'failed' | 'not_found' };
        Returns: boolean;
      };
      record_customer_cleaned: {
        Args: { p_hold_id: string; p_detached_count: number };
        Returns: boolean;
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
      deactivate_internal_user: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
      purge_old_webhook_events: {
        Args: { p_cutoff: string };
        Returns: number;
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
      // Agregada a mano (spec 0027): un `supabase gen types` puede no emitirla porque se le
      // revocó EXECUTE de anon/authenticated. NO borrar al regenerar tipos.
      audit_table_grants_to_public_roles: {
        Args: Record<string, never>;
        Returns: { table_name: string; role_name: string; privilege_type: string }[];
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
