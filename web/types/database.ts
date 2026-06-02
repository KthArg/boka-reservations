export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_type: string;
          created_at: string;
          entity_id: string;
          entity_type: string;
          id: string;
          metadata: Json;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_type: string;
          created_at?: string;
          entity_id: string;
          entity_type: string;
          id?: string;
          metadata?: Json;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_type?: string;
          created_at?: string;
          entity_id?: string;
          entity_type?: string;
          id?: string;
          metadata?: Json;
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
          booking_id: string;
          created_at: string;
          expires_at: string;
          id: string;
          last_used_at: string | null;
          token_hash: string;
        };
        Insert: {
          booking_id: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          last_used_at?: string | null;
          token_hash: string;
        };
        Update: {
          booking_id?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          last_used_at?: string | null;
          token_hash?: string;
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
      bookings: {
        Row: {
          checked_in_at: string | null;
          checked_in_by: string | null;
          created_at: string;
          currency: string;
          customer_email: string;
          customer_name: string;
          hold_id: string | null;
          id: string;
          locale: string;
          status: string;
          tickets_adult: number;
          tickets_child: number;
          tickets_student: number;
          total_amount_cents: number;
          tour_instance_id: string;
          updated_at: string;
        };
        Insert: {
          checked_in_at?: string | null;
          checked_in_by?: string | null;
          created_at?: string;
          currency?: string;
          customer_email: string;
          customer_name: string;
          hold_id?: string | null;
          id?: string;
          locale?: string;
          status?: string;
          tickets_adult?: number;
          tickets_child?: number;
          tickets_student?: number;
          total_amount_cents: number;
          tour_instance_id: string;
          updated_at?: string;
        };
        Update: {
          checked_in_at?: string | null;
          checked_in_by?: string | null;
          created_at?: string;
          currency?: string;
          customer_email?: string;
          customer_name?: string;
          hold_id?: string | null;
          id?: string;
          locale?: string;
          status?: string;
          tickets_adult?: number;
          tickets_child?: number;
          tickets_student?: number;
          total_amount_cents?: number;
          tour_instance_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bookings_checked_in_by_fkey';
            columns: ['checked_in_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_hold_id_fkey';
            columns: ['hold_id'];
            isOneToOne: false;
            referencedRelation: 'tour_holds';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_tour_instance_id_fkey';
            columns: ['tour_instance_id'];
            isOneToOne: false;
            referencedRelation: 'tour_instances';
            referencedColumns: ['id'];
          },
        ];
      };
      guide_access_tokens: {
        Row: {
          created_at: string;
          expires_at: string;
          guide_id: string;
          id: string;
          last_used_at: string | null;
          token_hash: string;
        };
        Insert: {
          created_at?: string;
          expires_at: string;
          guide_id: string;
          id?: string;
          last_used_at?: string | null;
          token_hash: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          guide_id?: string;
          id?: string;
          last_used_at?: string | null;
          token_hash?: string;
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
      notifications: {
        Row: {
          attempts: number;
          booking_id: string | null;
          cancelled_reason: string | null;
          channel: string;
          created_at: string;
          guide_id: string | null;
          id: string;
          kind: string;
          last_error: string | null;
          locale: string;
          provider: string | null;
          provider_message_id: string | null;
          recipient_email: string;
          scheduled_for: string;
          sent_at: string | null;
          status: string;
          tour_instance_id: string | null;
          updated_at: string;
        };
        Insert: {
          attempts?: number;
          booking_id?: string | null;
          cancelled_reason?: string | null;
          channel?: string;
          created_at?: string;
          guide_id?: string | null;
          id?: string;
          kind: string;
          last_error?: string | null;
          locale: string;
          provider?: string | null;
          provider_message_id?: string | null;
          recipient_email: string;
          scheduled_for: string;
          sent_at?: string | null;
          status?: string;
          tour_instance_id?: string | null;
          updated_at?: string;
        };
        Update: {
          attempts?: number;
          booking_id?: string | null;
          cancelled_reason?: string | null;
          channel?: string;
          created_at?: string;
          guide_id?: string | null;
          id?: string;
          kind?: string;
          last_error?: string | null;
          locale?: string;
          provider?: string | null;
          provider_message_id?: string | null;
          recipient_email?: string;
          scheduled_for?: string;
          sent_at?: string | null;
          status?: string;
          tour_instance_id?: string | null;
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
            foreignKeyName: 'notifications_guide_id_fkey';
            columns: ['guide_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'notifications_tour_instance_id_fkey';
            columns: ['tour_instance_id'];
            isOneToOne: false;
            referencedRelation: 'tour_instances';
            referencedColumns: ['id'];
          },
        ];
      };
      payments: {
        Row: {
          amount_cents: number;
          booking_id: string;
          created_at: string;
          currency: string;
          external_payment_id: string;
          external_provider: string;
          id: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount_cents: number;
          booking_id: string;
          created_at?: string;
          currency?: string;
          external_payment_id: string;
          external_provider?: string;
          id?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          booking_id?: string;
          created_at?: string;
          currency?: string;
          external_payment_id?: string;
          external_provider?: string;
          id?: string;
          status?: string;
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
        Row: {
          id: string;
          processed_at: string;
        };
        Insert: {
          id: string;
          processed_at?: string;
        };
        Update: {
          id?: string;
          processed_at?: string;
        };
        Relationships: [];
      };
      refunds: {
        Row: {
          amount_cents: number;
          attempts: number;
          booking_id: string;
          created_at: string;
          currency: string;
          external_refund_id: string | null;
          failure_reason: string | null;
          id: string;
          payment_id: string;
          reason: string | null;
          status: string;
          updated_at: string;
        };
        Insert: {
          amount_cents: number;
          attempts?: number;
          booking_id: string;
          created_at?: string;
          currency?: string;
          external_refund_id?: string | null;
          failure_reason?: string | null;
          id?: string;
          payment_id: string;
          reason?: string | null;
          status?: string;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          attempts?: number;
          booking_id?: string;
          created_at?: string;
          currency?: string;
          external_refund_id?: string | null;
          failure_reason?: string | null;
          id?: string;
          payment_id?: string;
          reason?: string | null;
          status?: string;
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
      tour_holds: {
        Row: {
          created_at: string;
          expires_at: string;
          held_seats: number;
          id: string;
          session_token: string;
          status: string;
          tour_instance_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          held_seats: number;
          id?: string;
          session_token: string;
          status?: string;
          tour_instance_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          held_seats?: number;
          id?: string;
          session_token?: string;
          status?: string;
          tour_instance_id?: string;
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
      tour_instance_guides: {
        Row: {
          assigned_at: string;
          assigned_by: string | null;
          guide_id: string;
          tour_instance_id: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by?: string | null;
          guide_id: string;
          tour_instance_id: string;
        };
        Update: {
          assigned_at?: string;
          assigned_by?: string | null;
          guide_id?: string;
          tour_instance_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_instance_guides_assigned_by_fkey';
            columns: ['assigned_by'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tour_instance_guides_guide_id_fkey';
            columns: ['guide_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tour_instance_guides_tour_instance_id_fkey';
            columns: ['tour_instance_id'];
            isOneToOne: false;
            referencedRelation: 'tour_instances';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_instances: {
        Row: {
          capacity_reserved: number;
          capacity_total: number;
          created_at: string;
          ends_at: string;
          id: string;
          schedule_id: string;
          starts_at: string;
          status: string;
          tour_id: string;
          updated_at: string;
        };
        Insert: {
          capacity_reserved?: number;
          capacity_total: number;
          created_at?: string;
          ends_at: string;
          id?: string;
          schedule_id: string;
          starts_at: string;
          status?: string;
          tour_id: string;
          updated_at?: string;
        };
        Update: {
          capacity_reserved?: number;
          capacity_total?: number;
          created_at?: string;
          ends_at?: string;
          id?: string;
          schedule_id?: string;
          starts_at?: string;
          status?: string;
          tour_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tour_instances_schedule_id_fkey';
            columns: ['schedule_id'];
            isOneToOne: false;
            referencedRelation: 'tour_schedules';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tour_instances_tour_id_fkey';
            columns: ['tour_id'];
            isOneToOne: false;
            referencedRelation: 'tours';
            referencedColumns: ['id'];
          },
        ];
      };
      tour_pricing: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          price_usd: number;
          season_label: string | null;
          ticket_type: Database['public']['Enums']['ticket_type'];
          tour_id: string;
          updated_at: string;
          valid_from: string | null;
          valid_until: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          price_usd: number;
          season_label?: string | null;
          ticket_type: Database['public']['Enums']['ticket_type'];
          tour_id: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          price_usd?: number;
          season_label?: string | null;
          ticket_type?: Database['public']['Enums']['ticket_type'];
          tour_id?: string;
          updated_at?: string;
          valid_from?: string | null;
          valid_until?: string | null;
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
          active: boolean;
          capacity: number;
          created_at: string;
          day_of_week: number;
          id: string;
          start_time: string;
          tour_id: string;
          updated_at: string;
          valid_from: string;
          valid_until: string | null;
        };
        Insert: {
          active?: boolean;
          capacity: number;
          created_at?: string;
          day_of_week: number;
          id?: string;
          start_time: string;
          tour_id: string;
          updated_at?: string;
          valid_from?: string;
          valid_until?: string | null;
        };
        Update: {
          active?: boolean;
          capacity?: number;
          created_at?: string;
          day_of_week?: number;
          id?: string;
          start_time?: string;
          tour_id?: string;
          updated_at?: string;
          valid_from?: string;
          valid_until?: string | null;
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
      tours: {
        Row: {
          cover_image_url: string | null;
          created_at: string;
          description_en: string;
          description_es: string;
          difficulty: string;
          duration_minutes: number;
          id: string;
          includes_en: string;
          includes_es: string;
          max_capacity: number;
          meeting_point_en: string;
          meeting_point_es: string;
          min_participants: number;
          name_en: string;
          name_es: string;
          slug: string;
          status: Database['public']['Enums']['tour_status'];
          updated_at: string;
        };
        Insert: {
          cover_image_url?: string | null;
          created_at?: string;
          description_en: string;
          description_es: string;
          difficulty: string;
          duration_minutes: number;
          id?: string;
          includes_en: string;
          includes_es: string;
          max_capacity: number;
          meeting_point_en: string;
          meeting_point_es: string;
          min_participants?: number;
          name_en: string;
          name_es: string;
          slug: string;
          status?: Database['public']['Enums']['tour_status'];
          updated_at?: string;
        };
        Update: {
          cover_image_url?: string | null;
          created_at?: string;
          description_en?: string;
          description_es?: string;
          difficulty?: string;
          duration_minutes?: number;
          id?: string;
          includes_en?: string;
          includes_es?: string;
          max_capacity?: number;
          meeting_point_en?: string;
          meeting_point_es?: string;
          min_participants?: number;
          name_en?: string;
          name_es?: string;
          slug?: string;
          status?: Database['public']['Enums']['tour_status'];
          updated_at?: string;
        };
        Relationships: [];
      };
      users: {
        Row: {
          active: boolean;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          locale: string;
          phone: string | null;
          role: Database['public']['Enums']['user_role'];
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email: string;
          full_name: string;
          id?: string;
          locale?: string;
          phone?: string | null;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string;
          full_name?: string;
          id?: string;
          locale?: string;
          phone?: string | null;
          role?: Database['public']['Enums']['user_role'];
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      cancel_booking: {
        Args: {
          p_actor_id: string;
          p_actor_type: string;
          p_booking_id: string;
          p_refund_amount_cents: number;
        };
        Returns: undefined;
      };
      confirm_booking: {
        Args: {
          p_booking_id: string;
          p_external_payment_id: string;
          p_total_seats: number;
        };
        Returns: undefined;
      };
      create_hold_atomic: {
        Args: { p_instance_id: string; p_seats: number; p_session: string };
        Returns: {
          created_at: string;
          expires_at: string;
          held_seats: number;
          id: string;
          session_token: string;
          status: string;
          tour_instance_id: string;
        };
        SetofOptions: {
          from: '*';
          to: 'tour_holds';
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
    };
    Enums: {
      ticket_type: 'adult' | 'child' | 'student';
      tour_status: 'active' | 'archived';
      user_role: 'admin' | 'staff' | 'guide';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      ticket_type: ['adult', 'child', 'student'],
      tour_status: ['active', 'archived'],
      user_role: ['admin', 'staff', 'guide'],
    },
  },
} as const;
